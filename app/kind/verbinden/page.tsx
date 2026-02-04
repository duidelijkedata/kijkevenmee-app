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
  const [activeSessions, setActiveSessions] = useState<{ id: string; code: string; created_at?: string }[]>([]);
  const [activeError, setActiveError] = useState<string | null>(null);

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
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

  const [drawing, setDrawing] = useState<null | { startX: number; startY: number; currentX: number; currentY: number }>(null);
  const [shapes, setShapes] = useState<DraftShape[]>([]);
  const [needsTapToPlay, setNeedsTapToPlay] = useState(false);

  // pan/zoom (bestond al)
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

    setNeedsTapToPlay(false);

    v.srcObject = stream;
    v.muted = true;
    v.playsInline = true;
    // @ts-ignore
    v.disablePictureInPicture = true;

    const tryPlay = async () => {
      try {
        await v.play();
        setNeedsTapToPlay(false);
      } catch {
        setNeedsTapToPlay(true);
      }
    };

    void tryPlay();
    v.onloadedmetadata = () => void tryPlay();
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

    setNeedsTapToPlay(false);
    setConnected(false);
    setStatus("idle");
    setRemoteQuality(null);

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
        setActiveError(j?.error ?? "Kan actieve sessies niet laden.");
        return;
      }
      setUseKoppelcode(Boolean(j?.use_koppelcode ?? true));
      setActiveSessions(Array.isArray(j?.sessions) ? j.sessions : []);
    } catch {
      setActiveSessions([]);
      setActiveError("Netwerkfout bij laden actieve sessies.");
    }
  }

  useEffect(() => {
    void refreshActiveSessions();
  }, []);

  async function connect(rawOverride?: string) {
    const raw = String(rawOverride ?? code).replace(/\D/g, "");
    if (raw.length !== 6) return alert("Vul 6 cijfers in.");

    await cleanup();
    setStatus("connecting");

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
      const [stream] = ev.streams;
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
      const [stream] = ev.streams;
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
            else attachStream(null);
          }
        }
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    });

    // ===== Camera signaling =====
    chCam.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;

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
    const delta = -Math.sign(e.deltaY) * 0.15;
    setZoom((z) => clamp(+(z + delta).toFixed(2), 1, 3));
  }

  function onPointerDownPan(e: React.PointerEvent) {
    if (annotate) return;
    setPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  }

  function onPointerMovePan(e: React.PointerEvent) {
    if (!panning || !panStartRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;

    // hard cap zodat je niet buiten beeld "kwijt raakt"
    const maxPan = 900;
    setPan({
      x: clamp(panStartRef.current.px + dx, -maxPan, maxPan),
      y: clamp(panStartRef.current.py + dy, -maxPan, maxPan),
    });
  }

  function onPointerUpPan() {
    setPanning(false);
    panStartRef.current = null;
  }

  function tapToPlay() {
    const v = videoRef.current;
    if (!v) return;
    v.play()
      .then(() => setNeedsTapToPlay(false))
      .catch(() => setNeedsTapToPlay(true));
  }

  function toggleFullscreen() {
    const el = wrapRef.current;
    if (!el) return;

    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ===== Drawing (bestaand) =====
  function getCanvasXY(e: React.PointerEvent) {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const vid = videoRef.current;
    if (!canvas || !wrap || !vid) return null;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    return { x, y };
  }

  function onCanvasPointerDown(e: React.PointerEvent) {
    if (!annotate) return;
    const p = getCanvasXY(e);
    if (!p) return;
    setDrawing({ startX: p.x, startY: p.y, currentX: p.x, currentY: p.y });
  }

  function onCanvasPointerMove(e: React.PointerEvent) {
    if (!drawing) return;
    const p = getCanvasXY(e);
    if (!p) return;
    setDrawing({ ...drawing, currentX: p.x, currentY: p.y });
  }

  function onCanvasPointerUp() {
    if (!drawing) return;

    const { startX, startY, currentX, currentY } = drawing;
    const dx = currentX - startX;
    const dy = currentY - startY;

    let shape: DraftShape | null = null;

    if (tool === "circle") {
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r > 8) shape = { kind: "circle", x: startX, y: startY, r };
    } else if (tool === "rect") {
      if (Math.abs(dx) > 8 && Math.abs(dy) > 8) {
        shape = { kind: "rect", x: startX, y: startY, w: dx, h: dy };
      }
    } else if (tool === "arrow") {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) shape = { kind: "arrow", x1: startX, y1: startY, x2: currentX, y2: currentY };
    }

    if (shape) setShapes((prev) => [...prev, shape]);
    setDrawing(null);
  }

  // Render draft overlay op canvas (bestaand)
  useEffect(() => {
    const canvas = canvasRef.current;
    const v = videoRef.current;
    if (!canvas || !v) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      const w = (v.videoWidth || 1280) | 0;
      const h = (v.videoHeight || 720) | 0;

      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      ctx.clearRect(0, 0, w, h);

      ctx.lineWidth = 6;
      ctx.strokeStyle = "#ff3b30";
      ctx.fillStyle = "rgba(255,59,48,0.15)";

      const all: DraftShape[] = [...shapes];

      if (drawing) {
        const { startX, startY, currentX, currentY } = drawing;
        const dx = currentX - startX;
        const dy = currentY - startY;

        if (tool === "circle") {
          const r = Math.sqrt(dx * dx + dy * dy);
          if (r > 1) all.push({ kind: "circle", x: startX, y: startY, r });
        } else if (tool === "rect") {
          all.push({ kind: "rect", x: startX, y: startY, w: dx, h: dy });
        } else if (tool === "arrow") {
          all.push({ kind: "arrow", x1: startX, y1: startY, x2: currentX, y2: currentY });
        }
      }

      for (const s of all) {
        if (s.kind === "circle") {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (s.kind === "rect") {
          ctx.beginPath();
          ctx.rect(s.x, s.y, s.w, s.h);
          ctx.fill();
          ctx.stroke();
        } else if (s.kind === "arrow") {
          const { x1, y1, x2, y2 } = s;
          const head = 18;
          const angle = Math.atan2(y2 - y1, x2 - x1);

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fillStyle = "#ff3b30";
          ctx.fill();
          ctx.fillStyle = "rgba(255,59,48,0.15)";
        }
      }

      requestAnimationFrame(render);
    };

    let raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [drawing, shapes, tool]);

  async function sendSnapshot() {
    const v = videoRef.current;
    const canvas = canvasRef.current;
    const ch = channelRef.current;
    if (!v || !canvas || !ch) return;

    const w = canvas.width || 1280;
    const h = canvas.height || 720;

    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext("2d");
    if (!ctx) return;

    try {
      ctx.drawImage(v, 0, 0, w, h);
      const jpeg = tmp.toDataURL("image/jpeg", 0.7);

      const packet: DrawPacket = {
        id: uid(),
        createdAt: Date.now(),
        snapshotJpeg: jpeg,
        shapes,
      };

      await ch.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "draw_packet", packet } satisfies SignalMsg,
      });

      setShapes([]);
      setAnnotate(false);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <FullscreenShell
      sidebar={
        <div className="p-3 flex flex-col gap-3">
          <div className="text-sm font-semibold">Kind – verbinden</div>

          {/* Active sessions (als useKoppelcode uit staat) */}
          {!useKoppelcode ? (
            <div className="rounded-xl border bg-white p-3">
              <div className="text-sm font-semibold">Actieve sessies</div>
              <div className="text-xs text-slate-600 mt-1">
                Kies een sessie om direct mee te kijken.
              </div>

              {activeError ? (
                <div className="mt-2 text-xs text-red-700">{activeError}</div>
              ) : null}

              <div className="mt-3 flex flex-col gap-2">
                {activeSessions.length ? (
                  activeSessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => void connect(s.code)}
                      className="text-left rounded-xl border px-3 py-2 hover:bg-slate-50"
                    >
                      <div className="text-xs text-slate-500">Code</div>
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
                  {status === "idle" ? "Niet verbonden" : status === "connecting" ? "Verbinden…" : status === "connected" ? "Verbonden" : "Fout"}
                </span>
              </div>
            </div>
          )}

          <div className="rounded-xl border bg-white p-3">
            <div className="text-sm font-semibold">Aantekeningen</div>

            <div className="mt-2 flex gap-2 flex-wrap">
              <Button variant={annotate ? "primary" : "secondary"} onClick={() => setAnnotate((v) => !v)}>
                {annotate ? "Tekenen aan" : "Tekenen uit"}
              </Button>
              <Button onClick={() => setShapes([])} disabled={!shapes.length}>
                Wis
              </Button>
              <Button variant="primary" onClick={() => void sendSnapshot()} disabled={!shapes.length || !connected}>
                Snapshot sturen
              </Button>
            </div>

            <div className="mt-3 flex gap-2 flex-wrap">
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
          </div>

          <div className="rounded-xl border bg-white p-3">
            <div className="text-sm font-semibold">Weergave</div>
            <div className="mt-2 flex gap-2 flex-wrap">
              <Button onClick={zoomOut}>-</Button>
              <Button onClick={zoomIn}>+</Button>
              <Button onClick={resetView}>Reset</Button>
              <Button onClick={toggleFullscreen}>Fullscreen</Button>
            </div>

            <div className="mt-2 text-xs text-slate-600">
              Actieve bron: <b>{activeSource === "camera" ? "Telefoon" : "Scherm"}</b>
              {remoteQuality ? (
                <>
                  {" "}
                  • Kwaliteit: <b>{remoteQuality}</b>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-auto">
            <Button onClick={() => void disconnect()} disabled={!connected} className="w-full">
              Verbreken
            </Button>
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
                  <div className="text-white/70 mb-3">
                    Je browser blokkeert autoplay. Klik hieronder om de stream te starten.
                  </div>
                  <Button variant="primary" onClick={tapToPlay}>
                    Start beeld
                  </Button>
                </div>
              </div>
            ) : null}

            {isFullscreen ? (
              <div className="absolute top-3 left-3 rounded-xl bg-black/60 text-white text-sm px-3 py-2">
                Fullscreen — druk <b>ESC</b> om terug te gaan
              </div>
            ) : null}
          </div>
        </div>
      </ViewerStage>
    </FullscreenShell>
  );
}
