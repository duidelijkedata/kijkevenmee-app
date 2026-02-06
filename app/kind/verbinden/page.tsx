"use client";

import type React from "react";
import { useMemo, useRef, useState, useEffect } from "react";
import { Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

import FullscreenShell from "@/components/meekijk/FullscreenShell";
import ViewerStage from "@/components/meekijk/ViewerStage";

type Quality = "low" | "medium" | "high";
type ActiveSource = "screen" | "camera";
type DrawTool = "circle" | "rect" | "arrow";

type DraftShape =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number };

type DrawPacket = {
  id: string;
  createdAt: number;
  snapshotJpeg: string; // data URL
  shapes: DraftShape[];
};

type SignalMsg =
  | { type: "hello"; at: number }
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any }
  | { type: "quality"; quality: Quality }
  | { type: "draw_packet"; packet: DrawPacket }
  | { type: "active_source"; source: ActiveSource };

function formatCode(v: string) {
  const digits = v.replace(/\D/g, "").slice(0, 6);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function uid() {
  return Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

export default function KindVerbinden() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [code, setCode] = useState("");

  // Als 'Meekijken starten met code' UIT staat, tonen we sessies die al aan jou zijn toegewezen.
  const [useKoppelcode, setUseKoppelcode] = useState<boolean>(true);
  const [activeSessions, setActiveSessions] = useState<
    { id: string; code: string; requester_name?: string | null; created_at?: string }[]
  >([]);
  const activeSessionsRef = useRef<
    { id: string; code: string; requester_name?: string | null; created_at?: string }[]
  >([]);

  const [activeError, setActiveError] = useState<string | null>(null);

  // ✅ Ouder initieert altijd (scenario zonder extra 6-cijferige code)
  const [parentOnline, setParentOnline] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const currentSessionCodeRef = useRef<string | null>(null);

  const parentName = useMemo(() => {
    const n = (activeSessions?.[0]?.requester_name ?? "").trim();
    return n || "Ouder";
  }, [activeSessions]);

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");

  const [connectHint, setConnectHint] = useState<string | null>(null);
  const gotAnySignalRef = useRef(false);
  const waitHintTimerRef = useRef<number | null>(null);
  const connectAttemptRef = useRef(0);

  const [remoteQuality, setRemoteQuality] = useState<Quality | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pcCamRef = useRef<RTCPeerConnection | null>(null);

  const channelRef = useRef<any>(null);
  const channelCamRef = useRef<any>(null);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);

  const activeSourceRef = useRef<ActiveSource>("screen");
  const [activeSource, setActiveSource] = useState<ActiveSource>("screen");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [annotate, setAnnotate] = useState(false);
  const [tool, setTool] = useState<DrawTool>("circle");

  const [drawing, setDrawing] = useState<null | { startX: number; startY: number; currentX: number; currentY: number }>(
    null
  );
  const [shapes, setShapes] = useState<DraftShape[]>([]);
  const [needsTapToPlay, setNeedsTapToPlay] = useState(false);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);

  function attachStream(stream: MediaStream | null) {
    const v = videoRef.current;
    if (!v) return;

    if (!stream) {
      try {
        (v as any).srcObject = null;
      } catch {}
      return;
    }

    try {
      (v as any).srcObject = stream;
    } catch {}

    try {
      const p = v.play();
      if (p && typeof (p as any).catch === "function") {
        (p as any).catch(() => setNeedsTapToPlay(true));
      }
    } catch {}
  }

  async function cleanup() {
    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;

    try {
      pcCamRef.current?.close();
    } catch {}
    pcCamRef.current = null;

    screenStreamRef.current = null;
    camStreamRef.current = null;

    try {
      if (channelRef.current) await supabase.removeChannel(channelRef.current);
    } catch {}
    channelRef.current = null;

    try {
      if (channelCamRef.current) await supabase.removeChannel(channelCamRef.current);
    } catch {}
    channelCamRef.current = null;

    attachStream(null);

    if (waitHintTimerRef.current) {
      window.clearTimeout(waitHintTimerRef.current);
      waitHintTimerRef.current = null;
    }
    gotAnySignalRef.current = false;
    setConnectHint(null);

    setNeedsTapToPlay(false);
    setConnected(false);
    setStatus("idle");
    setRemoteQuality(null);

    currentSessionCodeRef.current = null;

    activeSourceRef.current = "screen";
    setActiveSource("screen");
  }

  useEffect(() => {
    return () => {
      void cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshActiveSessions() {
    setActiveError(null);
    try {
      const r = await fetch("/api/sessions/active-for-helper");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setActiveSessions([]);
        activeSessionsRef.current = [];
        setParentOnline(false);
        setActiveError(j?.error ?? "Kan actieve sessies niet laden.");
        return;
      }
      setUseKoppelcode(Boolean(j?.use_koppelcode ?? true));
      const sessions = Array.isArray(j?.sessions) ? j.sessions : [];
      setActiveSessions(sessions);
      activeSessionsRef.current = sessions;
      setParentOnline(sessions.length > 0);
    } catch {
      setActiveSessions([]);
      activeSessionsRef.current = [];
      setParentOnline(false);
      setActiveError("Netwerkfout bij laden actieve sessies.");
    }
  }

  useEffect(() => {
    void refreshActiveSessions();
  }, []);

  // ✅ Live: ouder online + sessie actief (alleen wanneer useKoppelcode UIT staat)
  useEffect(() => {
    if (useKoppelcode) return;

    let stopped = false;

    const tick = async () => {
      if (stopped) return;

      await refreshActiveSessions();

      // Als we verbonden zijn en de sessie verdwijnt (ouder verbreekt), val terug naar idle.
      if ((connected || status === "connecting") && currentSessionCodeRef.current) {
        const stillActive = activeSessionsRef.current.some((s) => s.code === currentSessionCodeRef.current);
        if (!stillActive) {
          await cleanup();
          setSessionNotice("Sessie beëindigd door ouder.");
        }
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 4000);

    return () => {
      stopped = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useKoppelcode, connected, status]);

  async function connect(rawOverride?: string) {
    const raw = String(rawOverride ?? code).replace(/\D/g, "");
    if (raw.length !== 6) return alert("Vul 6 cijfers in.");

    await cleanup();
    setSessionNotice(null);
    currentSessionCodeRef.current = raw;
    setStatus("connecting");

    setConnectHint("Verbinden…");
    gotAnySignalRef.current = false;
    const attempt = ++connectAttemptRef.current;

    if (waitHintTimerRef.current) {
      window.clearTimeout(waitHintTimerRef.current);
      waitHintTimerRef.current = null;
    }
    waitHintTimerRef.current = window.setTimeout(() => {
      if (connectAttemptRef.current === attempt && !gotAnySignalRef.current) {
        setConnectHint(`Wachten op ${parentName}… (nog niet op schermdelen?)`);
      }
    }, 6000);

    activeSourceRef.current = "screen";
    setActiveSource("screen");

    const ch = supabase.channel(`signal:${raw}`);
    channelRef.current = ch;

    const chCam = supabase.channel(`signalcam:${raw}`);
    channelCamRef.current = chCam;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    pc.ontrack = (ev) => {
      const stream = ev.streams?.[0] ?? new MediaStream([ev.track]);
      if (!stream) return;

      screenStreamRef.current = stream;
      if (activeSourceRef.current === "screen") {
        attachStream(stream);
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        ch.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "ice", candidate: e.candidate } satisfies SignalMsg,
        });
      }
    };

    const pcCam = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcCamRef.current = pcCam;

    pcCam.ontrack = (ev) => {
      const stream = ev.streams?.[0] ?? new MediaStream([ev.track]);
      if (!stream) return;

      camStreamRef.current = stream;
      if (activeSourceRef.current === "camera") {
        attachStream(stream);
      }
    };

    pcCam.onicecandidate = (e) => {
      if (e.candidate) {
        chCam.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "ice", candidate: e.candidate } satisfies SignalMsg,
        });
      }
    };

    ch.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;

      gotAnySignalRef.current = true;
      if (waitHintTimerRef.current) {
        window.clearTimeout(waitHintTimerRef.current);
        waitHintTimerRef.current = null;
      }
      setConnectHint(null);

      try {
        const pc0 = pcRef.current;
        if (!pc0) return;

        if (msg.type === "offer") {
          await pc0.setRemoteDescription(msg.sdp);
          const answer = await pc0.createAnswer();
          await pc0.setLocalDescription(answer);

          await ch.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "answer", sdp: answer } satisfies SignalMsg,
          });

          setStatus("connected");
          setConnected(true);

          if (screenStreamRef.current && activeSourceRef.current === "screen") {
            attachStream(screenStreamRef.current);
          }
        } else if (msg.type === "ice") {
          await pc0.addIceCandidate(msg.candidate);
        } else if (msg.type === "quality") {
          setRemoteQuality(msg.quality);
        } else if (msg.type === "active_source") {
          activeSourceRef.current = msg.source;
          setActiveSource(msg.source);

          if (msg.source === "screen") {
            if (screenStreamRef.current) attachStream(screenStreamRef.current);
          } else if (msg.source === "camera") {
            if (camStreamRef.current) attachStream(camStreamRef.current);
          }
        }
      } catch (e) {
        console.error(e);
        setStatus("error");
        setConnectHint("Verbinding mislukt.");
        if (waitHintTimerRef.current) {
          window.clearTimeout(waitHintTimerRef.current);
          waitHintTimerRef.current = null;
        }
      }
    });

    chCam.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;

      gotAnySignalRef.current = true;
      if (waitHintTimerRef.current) {
        window.clearTimeout(waitHintTimerRef.current);
        waitHintTimerRef.current = null;
      }
      setConnectHint(null);

      try {
        const pc1 = pcCamRef.current;
        if (!pc1) return;

        if (msg.type === "offer") {
          await pc1.setRemoteDescription(msg.sdp);
          const answer = await pc1.createAnswer();
          await pc1.setLocalDescription(answer);

          await chCam.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "answer", sdp: answer } satisfies SignalMsg,
          });

          if (camStreamRef.current && activeSourceRef.current === "camera") {
            attachStream(camStreamRef.current);
          }
        } else if (msg.type === "ice") {
          await pc1.addIceCandidate(msg.candidate);
        }
      } catch (e) {
        console.error(e);
      }
    });

    ch.subscribe((st: string) => {
      if (st === "SUBSCRIBED") {
        ch.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "hello", at: Date.now() } satisfies SignalMsg,
        });
      }
    });

    chCam.subscribe((st: string) => {
      if (st === "SUBSCRIBED") {
        chCam.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "hello", at: Date.now() } satisfies SignalMsg,
        });
      }
    });
  }

  async function disconnect() {
    await cleanup();
  }

  function tapToPlay() {
    try {
      const v = videoRef.current;
      if (!v) return;
      setNeedsTapToPlay(false);
      const p = v.play();
      if (p && typeof (p as any).catch === "function") {
        (p as any).catch(() => setNeedsTapToPlay(true));
      }
    } catch {}
  }

  function zoomOut() {
    setZoom((z) => {
      const next = Math.max(1, +(z - 0.25).toFixed(2));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  function zoomIn() {
    setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)));
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function onWheel(e: React.WheelEvent) {
    if (!wrapRef.current) return;
    if (!e.ctrlKey) return;

    e.preventDefault();

    const rect = wrapRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const prevZoom = zoom;
    const dir = e.deltaY > 0 ? -1 : 1;
    const nextZoom = clamp(prevZoom + dir * 0.12, 1, 3);

    if (nextZoom === prevZoom) return;

    const scale = nextZoom / prevZoom;

    setZoom(nextZoom);
    setPan((p) => {
      const nx = (p.x - mx) * scale + mx;
      const ny = (p.y - my) * scale + my;

      const cap = 300;
      return {
        x: clamp(nx, -cap, cap),
        y: clamp(ny, -cap, cap),
      };
    });
  }

  function onPointerDownPan(e: React.PointerEvent) {
    if (annotate) return;
    setPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  }

  function onPointerMovePan(e: React.PointerEvent) {
    if (!panning) return;
    const start = panStartRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    const cap = 300;
    setPan({ x: clamp(start.px + dx, -cap, cap), y: clamp(start.py + dy, -cap, cap) });
  }

  function onPointerUpPan() {
    setPanning(false);
    panStartRef.current = null;
  }

  function redrawCanvas(nextShapes: DraftShape[]) {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const w = c.width;
    const h = c.height;

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(59,130,246,0.9)";
    ctx.fillStyle = "rgba(59,130,246,0.15)";

    for (const s of nextShapes) {
      if (s.kind === "rect") {
        ctx.strokeRect(s.x, s.y, s.w, s.h);
        ctx.fillRect(s.x, s.y, s.w, s.h);
      } else if (s.kind === "circle") {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (s.kind === "arrow") {
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();

        const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
        const headLen = 14;
        ctx.beginPath();
        ctx.moveTo(s.x2, s.y2);
        ctx.lineTo(s.x2 - headLen * Math.cos(angle - Math.PI / 7), s.y2 - headLen * Math.sin(angle - Math.PI / 7));
        ctx.lineTo(s.x2 - headLen * Math.cos(angle + Math.PI / 7), s.y2 - headLen * Math.sin(angle + Math.PI / 7));
        ctx.lineTo(s.x2, s.y2);
        ctx.fillStyle = "rgba(59,130,246,0.9)";
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function canvasToPacket(): DrawPacket | null {
    const v = videoRef.current;
    if (!v) return null;

    const w = v.videoWidth || 1280;
    const h = v.videoHeight || 720;

    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext("2d");
    if (!ctx) return null;

    try {
      ctx.drawImage(v, 0, 0, w, h);
      const overlay = canvasRef.current;
      if (overlay) ctx.drawImage(overlay, 0, 0, w, h);
    } catch {
      return null;
    }

    const jpeg = tmp.toDataURL("image/jpeg", 0.85);

    return {
      id: uid(),
      createdAt: Date.now(),
      snapshotJpeg: jpeg,
      shapes,
    };
  }

  async function sendDrawPacket() {
    if (!channelRef.current) return;
    const packet = canvasToPacket();
    if (!packet) return;

    try {
      await channelRef.current.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "draw_packet", packet } satisfies SignalMsg,
      });
    } catch (e) {
      console.error(e);
    }
  }

  function onCanvasPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!annotate) return;
    if (!wrapRef.current) return;

    const rect = wrapRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;

    setDrawing({ startX: x, startY: y, currentX: x, currentY: y });
  }

  function onCanvasPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    if (!wrapRef.current) return;

    const rect = wrapRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;

    const nextDrawing = { ...drawing, currentX: x, currentY: y };
    setDrawing(nextDrawing);

    const draft = draftFromDrawing(nextDrawing, tool);
    if (draft) redrawCanvas([...shapes, draft]);
  }

  function onCanvasPointerUp() {
    if (!drawing) return;

    const draft = draftFromDrawing(drawing, tool);
    setDrawing(null);
    if (!draft) return;

    const nextShapes = [...shapes, draft];
    setShapes(nextShapes);
    redrawCanvas(nextShapes);
  }

  function draftFromDrawing(
    d: { startX: number; startY: number; currentX: number; currentY: number },
    t: DrawTool
  ): DraftShape | null {
    const x1 = d.startX;
    const y1 = d.startY;
    const x2 = d.currentX;
    const y2 = d.currentY;

    if (t === "rect") {
      return { kind: "rect", x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    }
    if (t === "circle") {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const r = Math.max(4, Math.hypot(x2 - x1, y2 - y1) / 2);
      return { kind: "circle", x: cx, y: cy, r };
    }
    if (t === "arrow") {
      return { kind: "arrow", x1, y1, x2, y2 };
    }
    return null;
  }

  const canStartSession = !useKoppelcode && parentOnline && activeSessions.length > 0 && status !== "connecting" && !connected;
  const canEndSession = status !== "idle";

  return (
    <FullscreenShell
      sidebar={
        <div className="p-3 flex flex-col gap-3">
          <div className="text-sm font-semibold">Kind – verbinden</div>

          {!useKoppelcode ? (
            <div className="rounded-xl border bg-white p-3">
              <div className="text-sm font-semibold">Sessie</div>
              <div className="text-xs text-slate-600 mt-1">Ouder start altijd de sessie. Jij kunt pas starten als er een sessie klaarstaat.</div>

              <div className="mt-2 flex items-center gap-2 text-xs">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${parentOnline ? "bg-emerald-500" : "bg-slate-300"}`}
                  aria-hidden="true"
                />
                <span className="text-slate-700">
                  {parentOnline ? `${parentName} is online` : "Wachten tot ouder de sessie start"}
                </span>
              </div>

              {sessionNotice ? <div className="mt-2 text-xs text-slate-700">{sessionNotice}</div> : null}
              {activeError ? <div className="mt-2 text-xs text-red-700">{activeError}</div> : null}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={!canStartSession}
                  onClick={() => {
                    const first = activeSessions[0];
                    if (first) void connect(first.code);
                  }}
                >
                  Start een sessie
                </Button>

                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={!canEndSession}
                  onClick={() => void disconnect()}
                >
                  Sessie beëindigen
                </Button>
              </div>

              {/* ✅ Duidelijke reden als start disabled is */}
              <div className="mt-1 text-xs text-slate-500">
                {!parentOnline && "Wachten tot ouder een sessie start…"}
                {parentOnline && !activeSessions.length && "Geen actieve sessies gevonden."}
                {status === "connecting" && `Bezig met verbinden met ${parentName}…`}
                {connected && "Je bent verbonden."}
              </div>

              <div className="mt-2 text-xs text-slate-600">
                Status:{" "}
                <span className="font-semibold">
                  {status === "idle"
                    ? "Niet verbonden"
                    : status === "connecting"
                      ? "Verbinden…"
                      : status === "connected"
                        ? "Verbonden"
                        : "Fout"}
                </span>
                {connectHint ? <div className="mt-1 text-xs text-slate-500">{connectHint}</div> : null}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border bg-white p-3">
              <div className="text-sm font-semibold">Sessiecode</div>
              <div className="text-xs text-slate-600 mt-1">Vul de 6-cijferige code in die je ouder/helper ziet.</div>

              <div className="mt-3 flex gap-2">
                <Input value={formatCode(code)} onChange={(e) => setCode(e.target.value)} placeholder="123 456" />
                <Button variant="primary" onClick={() => void connect()} disabled={status === "connecting"}>
                  Verbinden
                </Button>
              </div>

              <div className="mt-2 text-xs text-slate-500">
                Status:{" "}
                <span className="font-semibold">
                  {status === "idle"
                    ? "Niet verbonden"
                    : status === "connecting"
                      ? "Verbinden…"
                      : status === "connected"
                        ? "Verbonden"
                        : "Fout"}
                </span>
                {connectHint ? <div className="mt-1 text-xs text-slate-500">{connectHint}</div> : null}
              </div>
            </div>
          )}

          <div className="rounded-xl border bg-white p-3">
            <div className="text-sm font-semibold">Aantekeningen</div>

            <div className="mt-3 flex flex-col gap-2">
              <Button onClick={() => setAnnotate((v) => !v)}>{annotate ? "Tekenen aan" : "Tekenen uit"}</Button>

              <div className="flex gap-2">
                <Button variant={tool === "circle" ? "primary" : "secondary"} onClick={() => setTool("circle")}>
                  Cirkel
                </Button>
                <Button variant={tool === "rect" ? "primary" : "secondary"} onClick={() => setTool("rect")}>
                  Rechthoek
                </Button>
                <Button variant={tool === "arrow" ? "primary" : "secondary"} onClick={() => setTool("arrow")}>
                  Pijl
                </Button>
              </div>

              <Button
                onClick={() => {
                  setShapes([]);
                  redrawCanvas([]);
                }}
                disabled={!shapes.length}
              >
                Wis
              </Button>

              <Button onClick={() => void sendDrawPacket()} disabled={!shapes.length || !connected}>
                Snapshot sturen
              </Button>
            </div>
          </div>

          <div className="rounded-xl border bg-white p-3">
            <div className="text-sm font-semibold">Zoom</div>
            <div className="mt-3 flex gap-2">
              <Button onClick={zoomOut}>-</Button>
              <Button onClick={zoomIn}>+</Button>
              <Button onClick={resetView}>Reset</Button>
            </div>
          </div>

          <div className="rounded-xl border bg-white p-3">
            <div className="text-sm font-semibold">Weergave</div>
            <div className="mt-3 flex flex-col gap-2">
              <Button onClick={() => setIsFullscreen(true)}>Fullscreen</Button>

              {remoteQuality ? (
                <div className="text-xs text-slate-600">
                  Kwaliteit: <span className="font-semibold">{remoteQuality}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      }
    >
      <ViewerStage>
        <div className="h-full w-full flex items-center justify-center bg-black">
          <div
            ref={wrapRef}
            className="relative w-full h-full overflow-hidden"
            onWheel={onWheel}
            onPointerDown={onPointerDownPan}
            onPointerMove={onPointerMovePan}
            onPointerUp={onPointerUpPan}
            onPointerCancel={onPointerUpPan}
            style={{ touchAction: annotate ? "none" : "pan-x pan-y" }}
          >
            <div
              className="absolute top-3 right-3 rounded-full bg-white/90 px-3 py-1 text-xs text-slate-800 z-10"
              aria-label="actieve bron"
            >
              Bron: <span className="font-semibold">{activeSource === "camera" ? "Telefoon camera" : "PC scherm"}</span>
            </div>

            <div
              className="absolute inset-0"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
              }}
            >
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
            </div>

            <canvas
              ref={canvasRef}
              className="absolute inset-0"
              style={{ pointerEvents: annotate ? "auto" : "none" }}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={onCanvasPointerUp}
              onPointerLeave={onCanvasPointerUp}
            />

            {needsTapToPlay ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-2xl bg-black/70 border border-white/15 text-white px-4 py-3 text-sm">
                  <div className="font-semibold mb-1">Klik om beeld te starten</div>
                  <div className="text-white/70 mb-3">Je browser blokkeert autoplay. Klik hieronder om de stream te starten.</div>
                  <Button variant="primary" onClick={tapToPlay}>
                    Start beeld
                  </Button>
                </div>
              </div>
            ) : null}

            {isFullscreen ? (
              <div className="absolute top-3 left-3 rounded-xl bg-black/60 text-white text-sm px-3 py-2 z-10">
                Fullscreen — druk <b>ESC</b> om terug te gaan
              </div>
            ) : null}
          </div>
        </div>
      </ViewerStage>
    </FullscreenShell>
  );
}
