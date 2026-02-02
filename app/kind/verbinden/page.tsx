"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

import FullscreenShell from "@/components/meekijk/FullscreenShell";
import ViewerStage from "@/components/meekijk/ViewerStage";

type Quality = "low" | "medium" | "high";
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
  | { type: "draw_packet"; packet: DrawPacket };

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

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [remoteQuality, setRemoteQuality] = useState<Quality | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);

  // ✅ autoplay fallback state
  const [needsTapToPlay, setNeedsTapToPlay] = useState(false);

  // Zoom + pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panDragRef = useRef<{ dragging: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  });

  // Fullscreen detect
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Draft annotations
  const [annotate, setAnnotate] = useState(false);
  const [tool, setTool] = useState<DrawTool>("circle");
  const [draft, setDraft] = useState<DraftShape[]>([]);
  const previewRef = useRef<DraftShape | null>(null);
  const drawDragRef = useRef<{ drawing: boolean; startNX: number; startNY: number }>({
    drawing: false,
    startNX: 0,
    startNY: 0,
  });

  function clampPan(nextPan: { x: number; y: number }, nextZoom = zoom) {
    const vp = viewportRef.current;
    const vid = videoRef.current;
    if (!vp || !vid) return nextPan;

    const vpW = vp.clientWidth || 0;
    const vpH = vp.clientHeight || 0;
    const baseW = vid.clientWidth || 0;
    const baseH = vid.clientHeight || 0;
    if (!vpW || !vpH || !baseW || !baseH) return nextPan;

    const scaledW = baseW * nextZoom;
    const scaledH = baseH * nextZoom;

    const minX = Math.min(0, vpW - scaledW);
    const minY = Math.min(0, vpH - scaledH);

    return { x: clamp(nextPan.x, minX, 0), y: clamp(nextPan.y, minY, 0) };
  }

  useEffect(() => {
    setPan((p) => clampPan(p, zoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  async function cleanup() {
    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;

    try {
      if (channelRef.current) await supabase.removeChannel(channelRef.current);
    } catch {}
    channelRef.current = null;

    if (videoRef.current) {
      try {
        (videoRef.current as any).srcObject = null;
      } catch {}
    }

    setNeedsTapToPlay(false);
    setConnected(false);
    setStatus("idle");
    setRemoteQuality(null);
  }

  useEffect(() => {
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    const raw = code.replace(/\D/g, "");
    if (raw.length !== 6) return alert("Vul 6 cijfers in.");

    await cleanup();
    setStatus("connecting");

    const ch = supabase.channel(`signal:${raw}`);
    channelRef.current = ch;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    // ✅ Track handler
    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (!stream) return;

      const v = videoRef.current;
      if (!v) return;

      setNeedsTapToPlay(false);

      v.srcObject = stream;

      // ✅ extra zekerheid: autoplay toestaan
      v.muted = true; // belangrijk voor Safari autoplay
      v.playsInline = true;

      const tryPlay = async () => {
        try {
          await v.play();
          setNeedsTapToPlay(false);
        } catch {
          // autoplay geblokkeerd → toon knop
          setNeedsTapToPlay(true);
        }
      };

      // meteen proberen
      tryPlay();

      // en nog eens zodra metadata er is
      v.onloadedmetadata = () => {
        tryPlay();
      };
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

    ch.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;

      try {
        if (!pcRef.current) return;

        if (msg.type === "offer") {
          await pcRef.current.setRemoteDescription(msg.sdp);
          const answer = await pcRef.current.createAnswer();
          await pcRef.current.setLocalDescription(answer);

          await ch.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "answer", sdp: answer } satisfies SignalMsg,
          });

          setStatus("connected");
          setConnected(true);
        } else if (msg.type === "ice") {
          await pcRef.current.addIceCandidate(msg.candidate);
        } else if (msg.type === "quality") {
          setRemoteQuality(msg.quality);
        }
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    });

    // ✅ HELLO handshake (ouder kan al gestart zijn)
    ch.subscribe((st: string) => {
      if (st === "SUBSCRIBED") {
        ch.send({
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

  async function fullscreen() {
    try {
      const el = videoRef.current;
      if (!el) return;
      await (el as any).requestFullscreen?.();
    } catch {}
  }

  // pointer -> normalized
  function pointerToNormalized(e: React.PointerEvent) {
    const vp = viewportRef.current;
    const vid = videoRef.current;
    if (!vp || !vid) return { nx: 0, ny: 0 };

    const rect = vp.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const baseW = vid.clientWidth || 1;
    const baseH = vid.clientHeight || 1;

    const ux = (px - pan.x) / zoom;
    const uy = (py - pan.y) / zoom;

    const nx = clamp(ux / baseW, 0, 1);
    const ny = clamp(uy / baseH, 0, 1);
    return { nx, ny };
  }

  // Render draft shapes on canvas
  useEffect(() => {
    let raf = 0;

    function resizeCanvas() {
      const c = canvasRef.current;
      const vp = viewportRef.current;
      if (!c || !vp) return;
      const w = vp.clientWidth;
      const h = vp.clientHeight;
      if (!w || !h) return;

      const dpr = window.devicePixelRatio || 1;
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }

    function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = 18;
      const a1 = angle - Math.PI / 7;
      const a2 = angle + Math.PI / 7;

      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(a1), y2 - head * Math.sin(a1));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(a2), y2 - head * Math.sin(a2));
      ctx.stroke();
    }

    function loop() {
      const c = canvasRef.current;
      const vp = viewportRef.current;
      const vid = videoRef.current;

      if (!c || !vp || !vid) {
        raf = requestAnimationFrame(loop);
        return;
      }

      resizeCanvas();
      const ctx = c.getContext("2d");
      if (!ctx) {
        raf = requestAnimationFrame(loop);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const w = vp.clientWidth;
      const h = vp.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const baseW = vid.clientWidth || 1;
      const baseH = vid.clientHeight || 1;

      const all = [...draft];
      if (previewRef.current) all.push(previewRef.current);

      ctx.lineWidth = 4;
      ctx.strokeStyle = "#60a5fa";
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 6;

      for (const s of all) {
        if (s.kind === "circle") {
          const tx = pan.x + s.x * baseW * zoom;
          const ty = pan.y + s.y * baseH * zoom;
          const r = s.r * Math.max(baseW, baseH) * zoom;
          ctx.beginPath();
          ctx.arc(tx, ty, r, 0, Math.PI * 2);
          ctx.stroke();
        } else if (s.kind === "rect") {
          const x = pan.x + s.x * baseW * zoom;
          const y = pan.y + s.y * baseH * zoom;
          const rw = s.w * baseW * zoom;
          const rh = s.h * baseH * zoom;
          ctx.strokeRect(x, y, rw, rh);
        } else {
          const x1 = pan.x + s.x1 * baseW * zoom;
          const y1 = pan.y + s.y1 * baseH * zoom;
          const x2 = pan.x + s.x2 * baseW * zoom;
          const y2 = pan.y + s.y2 * baseH * zoom;
          drawArrow(ctx, x1, y1, x2, y2);
        }
      }

      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [draft, pan.x, pan.y, zoom]);

  // Pan handlers
  function onViewportPointerDown(e: React.PointerEvent) {
    if (annotate) return;
    if (zoom <= 1) return;
    (e.currentTarget as any).setPointerCapture?.(e.pointerId);
    panDragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y };
  }
  function onViewportPointerMove(e: React.PointerEvent) {
    if (!panDragRef.current.dragging) return;
    const dx = e.clientX - panDragRef.current.startX;
    const dy = e.clientY - panDragRef.current.startY;
    setPan(clampPan({ x: panDragRef.current.baseX + dx, y: panDragRef.current.baseY + dy }));
  }
  function onViewportPointerUp() {
    panDragRef.current.dragging = false;
  }

  // Draw handlers
  function onCanvasPointerDown(e: React.PointerEvent) {
    if (!annotate || !connected) return;
    (e.currentTarget as any).setPointerCapture?.(e.pointerId);

    const { nx, ny } = pointerToNormalized(e);
    drawDragRef.current = { drawing: true, startNX: nx, startNY: ny };

    if (tool === "circle") previewRef.current = { kind: "circle", x: nx, y: ny, r: 0.001 };
    else if (tool === "rect") previewRef.current = { kind: "rect", x: nx, y: ny, w: 0.001, h: 0.001 };
    else previewRef.current = { kind: "arrow", x1: nx, y1: ny, x2: nx, y2: ny };
  }

  function onCanvasPointerMove(e: React.PointerEvent) {
    if (!annotate || !drawDragRef.current.drawing) return;

    const { nx, ny } = pointerToNormalized(e);
    const startX = drawDragRef.current.startNX;
    const startY = drawDragRef.current.startNY;

    const s = previewRef.current;
    if (!s) return;

    if (s.kind === "circle") {
      const dx = nx - startX;
      const dy = ny - startY;
      const r = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      previewRef.current = { kind: "circle", x: startX, y: startY, r };
    } else if (s.kind === "rect") {
      const x = Math.min(startX, nx);
      const y = Math.min(startY, ny);
      const w = Math.max(0.01, Math.abs(nx - startX));
      const h = Math.max(0.01, Math.abs(ny - startY));
      previewRef.current = { kind: "rect", x, y, w, h };
    } else {
      previewRef.current = { kind: "arrow", x1: startX, y1: startY, x2: nx, y2: ny };
    }
  }

  function onCanvasPointerUp() {
    if (!annotate || !drawDragRef.current.drawing) return;
    drawDragRef.current.drawing = false;

    const s = previewRef.current;
    previewRef.current = null;
    if (!s) return;

    setDraft((prev) => [...prev, s]);
  }

  function captureSnapshotJpeg(): string | null {
    const v = videoRef.current;
    if (!v) return null;
    const vw = v.videoWidth || 0;
    const vh = v.videoHeight || 0;
    if (!vw || !vh) return null;

    const c = document.createElement("canvas");
    c.width = vw;
    c.height = vh;
    const ctx = c.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(v, 0, 0, vw, vh);
    return c.toDataURL("image/jpeg", 0.72);
  }

  async function shareToParent() {
    if (!connected) return;
    if (draft.length === 0) {
      alert("Maak eerst een cirkel/kader/pijl en klik dan op Delen.");
      return;
    }

    const snapshot = captureSnapshotJpeg();
    if (!snapshot) {
      alert("Kan nog geen snapshot maken. Wacht 1 seconde en probeer opnieuw.");
      return;
    }

    const packet: DrawPacket = { id: uid(), createdAt: Date.now(), snapshotJpeg: snapshot, shapes: draft };

    try {
      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "draw_packet", packet } satisfies SignalMsg,
      });

      setDraft([]);
      previewRef.current = null;
    } catch {
      alert("Delen mislukt. Probeer opnieuw.");
    }
  }

  const raw = code.replace(/\D/g, "");
  const canConnect = raw.length === 6;

  async function tapToPlay() {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.muted = true;
      await v.play();
      setNeedsTapToPlay(false);
    } catch {
      // blijft geblokkeerd
      setNeedsTapToPlay(true);
    }
  }

  return (
    <FullscreenShell
      sidebarTitle="Kind"
      sidebarSubtitle="Controls"
      sidebar={
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <div className="text-sm text-white/60">Status</div>
            <div className="text-sm text-white">
              <span className="text-white/70">verbinding:</span> <span className="font-mono">{status}</span>
              {remoteQuality ? (
                <>
                  <span className="text-white/50"> • </span>
                  <span className="text-white/70">kwaliteit ouder:</span> <span className="font-mono">{remoteQuality}</span>
                </>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <div className="text-sm text-white/60 mb-2">Koppelcode</div>
            <div className="flex flex-col gap-2">
              <Input
                className="bg-white text-slate-900 placeholder:text-slate-400"
                value={code}
                onChange={(e) => setCode(formatCode(e.target.value))}
                placeholder="123 456"
                inputMode="numeric"
              />
              {!connected ? (
                <Button variant="primary" onClick={connect} disabled={!canConnect || status === "connecting"}>
                  {status === "connecting" ? "Verbinden…" : "Verbind"}
                </Button>
              ) : (
                <Button onClick={disconnect}>Stop</Button>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <div className="text-sm text-white/60 mb-2">Beeld</div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={zoomOut} disabled={zoom <= 1} title="Zoom uit">
                −
              </Button>
              <Button onClick={zoomIn} disabled={zoom >= 3} title="Zoom in">
                +
              </Button>
              <Button onClick={resetView}>Reset</Button>
              <Button onClick={fullscreen}>Fullscreen</Button>
            </div>

            <div className="mt-2">
              <input
                type="range"
                min={1}
                max={3}
                step={0.25}
                value={zoom}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setZoom(v);
                  if (v === 1) setPan({ x: 0, y: 0 });
                }}
                className="w-full"
              />
              <div className="text-xs text-white/60 mt-1">
                Zoom: <span className="font-mono text-white/80">{Math.round(zoom * 100)}%</span>
              </div>
              <div className="text-xs text-white/60">
                Pan: <span className="font-mono text-white/80">{Math.round(pan.x)},{Math.round(pan.y)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <div className="text-sm text-white/60 mb-2">Aantekeningen</div>

            <label className="flex items-center gap-2 text-sm text-white/80">
              <input type="checkbox" checked={annotate} onChange={(e) => setAnnotate(e.target.checked)} disabled={!connected} />
              Aan
            </label>

            <div className="mt-2 flex flex-col gap-2">
              <select
                value={tool}
                onChange={(e) => setTool(e.target.value as DrawTool)}
                className="h-10 rounded-xl border px-3 bg-white text-slate-900"
                disabled={!annotate}
              >
                <option value="circle">Cirkel</option>
                <option value="rect">Kader</option>
                <option value="arrow">Pijl</option>
              </select>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setDraft((d) => d.slice(0, -1))} disabled={!annotate || draft.length === 0} title="Undo">
                  Undo
                </Button>
                <Button onClick={() => setDraft([])} disabled={!annotate || draft.length === 0}>
                  Wissen
                </Button>
                <Button variant="primary" onClick={shareToParent} disabled={!annotate || draft.length === 0}>
                  Delen
                </Button>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <ViewerStage>
        <div
          ref={viewportRef}
          className="absolute inset-0"
          style={{
            touchAction: "none",
            cursor: annotate ? "crosshair" : zoom > 1 ? (panDragRef.current.dragging ? "grabbing" : "grab") : "default",
          }}
          onPointerDown={onViewportPointerDown}
          onPointerMove={onViewportPointerMove}
          onPointerUp={onViewportPointerUp}
          onPointerCancel={onViewportPointerUp}
          onPointerLeave={onViewportPointerUp}
        >
          <div
            className="absolute inset-0"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "top left",
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain"
            />
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
      </ViewerStage>
    </FullscreenShell>
  );
}
