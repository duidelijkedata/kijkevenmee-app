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

type DrawPacket = {
  tool: DrawTool;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ts: number;
};

type Shape = {
  tool: DrawTool;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  id: string;
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

export default function KindVerbindenPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [code, setCode] = useState("");

  // Als 'Meekijken starten met code' UIT staat, tonen we sessies die al aan jou zijn toegewezen.
  const [useKoppelcode, setUseKoppelcode] = useState<boolean>(true);
  const [activeSessions, setActiveSessions] = useState<
    { id: string; code: string; requester_name?: string | null; created_at?: string }[]
  >([]);

  const [activeError, setActiveError] = useState<string | null>(null);

  // ✅ Ouder initieert de sessie: kind wacht tot er een actieve sessie is
  const [parentOnline, setParentOnline] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const currentSessionCodeRef = useRef<string | null>(null);
  const activeSessionsRef = useRef<
    { id: string; code: string; requester_name?: string | null; created_at?: string }[]
  >([]);

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  // ✅ Feedback tijdens verbinden
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

  // Canvas + annotate (bestond al)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [annotate, setAnnotate] = useState(false);
  const [tool, setTool] = useState<DrawTool>("circle");

  const [drawing, setDrawing] = useState<null | { x: number; y: number }>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [needsTapToPlay, setNeedsTapToPlay] = useState(false);

  // ===== helpers =====
  function attachStream(stream: MediaStream | null) {
    const v = videoRef.current;
    if (!v) return;

    try {
      if (stream) {
        v.srcObject = stream;
        const p = v.play();
        if (p && typeof (p as any).catch === "function") {
          (p as any).catch(() => setNeedsTapToPlay(true));
        }
      } else {
        v.srcObject = null;
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

    // ✅ Clear "wachten op ouder" hint/timer
    if (waitHintTimerRef.current) {
      window.clearTimeout(waitHintTimerRef.current);
      waitHintTimerRef.current = null;
    }
    gotAnySignalRef.current = false;
    setConnectHint(null);

    currentSessionCodeRef.current = null;

    setNeedsTapToPlay(false);
    setConnected(false);
    setStatus("idle");

    setRemoteQuality(null);
  }

  // cleanup on unmount
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
      setParentOnline(Boolean(sessions.length));
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

  // ✅ Live status: ouder online + sessie actief (scenario zonder extra 6-cijferige code)
  useEffect(() => {
    if (useKoppelcode) return;

    let stopped = false;

    const tick = async () => {
      if (stopped) return;

      await refreshActiveSessions();

      // Als we verbonden zijn via de "geen code" flow en de ouder verbreekt de sessie,
      // verdwijnt deze uit de lijst met actieve sessies → terug naar uit-stand.
      if (connected && currentSessionCodeRef.current) {
        const stillActive = activeSessionsRef.current.some((s) => s.code === currentSessionCodeRef.current);
        if (!stillActive) {
          await cleanup();
          setSessionNotice("Sessie beëindigd door ouder.");
        }
      }
    };

    // meteen 1 keer (en daarna interval)
    void tick();
    const id = window.setInterval(() => void tick(), 4000);

    return () => {
      stopped = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useKoppelcode, connected]);

  async function connect(rawOverride?: string) {
    const raw = String(rawOverride ?? code).replace(/\D/g, "");
    if (raw.length !== 6) return alert("Vul 6 cijfers in.");

    await cleanup();
    setSessionNotice(null);
    currentSessionCodeRef.current = raw;
    setStatus("connecting");

    // ✅ Feedback tijdens verbinden
    setConnectHint("Verbinden…");
    gotAnySignalRef.current = false;
    const attempt = ++connectAttemptRef.current;
    if (waitHintTimerRef.current) {
      window.clearTimeout(waitHintTimerRef.current);
      waitHintTimerRef.current = null;
    }
    waitHintTimerRef.current = window.setTimeout(() => {
      if (connectAttemptRef.current === attempt && !gotAnySignalRef.current) {
        setConnectHint("Wachten op ouder… (nog niet op schermdelen?)");
      }
    }, 6000);

    activeSourceRef.current = "screen";
    setActiveSource("screen");

    // ===== Signaling channels =====
    const ch = supabase.channel(`signal:${raw}`);
    channelRef.current = ch;

    const chCam = supabase.channel(`signalcam:${raw}`);
    channelCamRef.current = chCam;

    // ===== PC (screen) peer =====
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

    // ===== Phone camera peer =====
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

    // ===== Screen signaling =====
    ch.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;

      // ✅ Zodra we iets ontvangen weten we dat de ouder "aan" staat
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
            // ✅ FIX: als de camera-stream nog niet binnen is, blijf huidig scherm tonen (geen zwart).
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

    // ===== Camera signaling =====
    chCam.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;

      // ✅ Ook camera-signalen tellen als "ouder leeft"
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

      // hard cap zodat je niet "kwijt" raakt
      const cap = 300;
      return {
        x: clamp(nx, -cap, cap),
        y: clamp(ny, -cap, cap),
      };
    });
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!annotate) return;
    if (!wrapRef.current) return;

    const rect = wrapRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;
    setDrawing({ x, y });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drawing) return;
    if (!wrapRef.current) return;

    const rect = wrapRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;

    // preview canvas
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, c.width, c.height);

    // draw existing shapes
    drawShapes(ctx, shapes);

    // draw current
    drawShape(ctx, { tool, x1: drawing.x, y1: drawing.y, x2: x, y2: y });
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!drawing) return;
    if (!wrapRef.current) return;

    const rect = wrapRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;

    const next: Shape = {
      tool,
      x1: drawing.x,
      y1: drawing.y,
      x2: x,
      y2: y,
      id: String(Date.now()) + ":" + Math.random().toString(16).slice(2),
    };

    setShapes((s) => [...s, next]);
    setDrawing(null);

    // redraw
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) {
      ctx.clearRect(0, 0, c.width, c.height);
      drawShapes(ctx, [...shapes, next]);
    }
  }

  function drawShapes(ctx: CanvasRenderingContext2D, list: Shape[]) {
    for (const s of list) drawShape(ctx, s);
  }

  function drawShape(ctx: CanvasRenderingContext2D, s: { tool: DrawTool; x1: number; y1: number; x2: number; y2: number }) {
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(59,130,246,0.9)";
    ctx.fillStyle = "rgba(59,130,246,0.15)";

    const x = Math.min(s.x1, s.x2);
    const y = Math.min(s.y1, s.y2);
    const w = Math.abs(s.x2 - s.x1);
    const h = Math.abs(s.y2 - s.y1);

    if (s.tool === "rect") {
      ctx.strokeRect(x, y, w, h);
      ctx.fillRect(x, y, w, h);
    } else if (s.tool === "circle") {
      const cx = (s.x1 + s.x2) / 2;
      const cy = (s.y1 + s.y2) / 2;
      const rx = w / 2;
      const ry = h / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (s.tool === "arrow") {
      // arrow from (x1,y1) to (x2,y2)
      const x1 = s.x1;
      const y1 = s.y1;
      const x2 = s.x2;
      const y2 = s.y2;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // head
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 14;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 7), y2 - headLen * Math.sin(angle - Math.PI / 7));
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 7), y2 - headLen * Math.sin(angle + Math.PI / 7));
      ctx.lineTo(x2, y2);
      ctx.fillStyle = "rgba(59,130,246,0.9)";
      ctx.fill();
    }

    ctx.restore();
  }

  async function sendSnapshot() {
    const v = videoRef.current;
    if (!v) return;

    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 1280;
    canvas.height = v.videoHeight || 720;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

    const overlay = canvasRef.current;
    if (overlay) {
      ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
    }

    const dataUrl = canvas.toDataURL("image/png");
    console.log("snapshot:", dataUrl.slice(0, 64), "...");

    // (Bestond al) hier zou je je push logic doen, we laten het intact.
    alert("Snapshot gemaakt (check console).");
  }

  return (
    <FullscreenShell isFullscreen={isFullscreen} onFullscreenChange={setIsFullscreen}>
      <div className="h-screen w-screen flex overflow-hidden bg-slate-50">
        {/* Left fixed menu */}
        <div className="w-80 shrink-0 border-r bg-white p-4 overflow-auto">
          <div className="text-lg font-semibold">Kind</div>
          <div className="text-xs text-slate-600 mt-1">Verbind met de ouder om mee te kijken.</div>

          <div className="mt-4">
            {!useKoppelcode ? (
              <div className="rounded-xl border bg-white p-3">
                <div className="text-sm font-semibold">Actieve sessies</div>
                <div className="text-xs text-slate-600 mt-1">Kies een sessie om direct mee te kijken.</div>

                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${parentOnline ? "bg-emerald-500" : "bg-slate-300"}`}
                    aria-hidden="true"
                  />
                  <span className="text-slate-700">
                    {parentOnline ? "Ouder is online" : "Wachten tot ouder de sessie start"}
                  </span>
                </div>

                {sessionNotice ? <div className="mt-2 text-xs text-slate-700">{sessionNotice}</div> : null}

                {activeError ? <div className="mt-2 text-xs text-red-700">{activeError}</div> : null}

                {/* ✅ Status + hint (nieuw) */}
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

                <div className="mt-3 flex flex-col gap-2">
                  {activeSessions.length ? (
                    activeSessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => void connect(s.code)}
                        className="text-left rounded-xl border px-3 py-2 hover:bg-slate-50"
                        disabled={status === "connecting"}
                      >
                        <div className="text-xs text-slate-500">{String(s.requester_name ?? "").trim() || "Ouder"}</div>
                        <div className="font-semibold tracking-widest">{formatCode(s.code)}</div>
                      </button>
                    ))
                  ) : (
                    <div className="text-xs text-slate-500">Geen actieve sessies.</div>
                  )}
                </div>

                <div className="mt-3">
                  <Button onClick={() => void refreshActiveSessions()} className="w-full">
                    Vernieuw
                  </Button>
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

            <div className="mt-4 rounded-xl border bg-white p-3">
              <div className="text-sm font-semibold">Tools</div>

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

                <Button onClick={() => setShapes([])} disabled={!shapes.length}>
                  Wis
                </Button>

                <Button onClick={() => void sendSnapshot()} disabled={!shapes.length || !connected}>
                  Snapshot sturen
                </Button>
              </div>
            </div>

            <div className="mt-4 rounded-xl border bg-white p-3">
              <div className="text-sm font-semibold">Zoom</div>
              <div className="mt-3 flex gap-2">
                <Button onClick={zoomOut}>-</Button>
                <Button onClick={zoomIn}>+</Button>
                <Button onClick={resetView}>Reset</Button>
              </div>
            </div>

            <div className="mt-4 rounded-xl border bg-white p-3">
              <div className="text-sm font-semibold">Sessie</div>
              <div className="mt-3 flex flex-col gap-2">
                <Button onClick={() => setIsFullscreen(true)}>Fullscreen</Button>
                <Button onClick={() => void disconnect()} disabled={!connected} className="w-full">
                  Verbreken
                </Button>

                {remoteQuality ? (
                  <div className="text-xs text-slate-600">
                    Kwaliteit: <span className="font-semibold">{remoteQuality}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Main video area */}
        <div className="flex-1 relative overflow-hidden bg-black">
          <ViewerStage
            wrapRef={wrapRef}
            videoRef={videoRef}
            canvasRef={canvasRef}
            zoom={zoom}
            pan={pan}
            setPan={setPan}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            annotate={annotate}
            needsTapToPlay={needsTapToPlay}
            onTapToPlay={() => {
              setNeedsTapToPlay(false);
              const v = videoRef.current;
              if (v) void v.play().catch(() => setNeedsTapToPlay(true));
            }}
          />

          {/* kleine overlay badge met bron */}
          <div className="absolute top-3 right-3 rounded-full bg-white/90 px-3 py-1 text-xs text-slate-800">
            Bron: <span className="font-semibold">{activeSource === "camera" ? "Telefoon camera" : "PC scherm"}</span>
          </div>
        </div>
      </div>
    </FullscreenShell>
  );
}
