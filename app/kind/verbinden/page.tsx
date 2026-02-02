"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Card, Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Quality = "low" | "medium" | "high";
type DrawTool = "circle" | "rect";

type DraftShape =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number };

type DrawPacket = {
  id: string;
  createdAt: number;
  snapshotJpeg: string; // data URL
  shapes: DraftShape[];
};

type SignalMsg =
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

  // Zoom + pan (zoals je al had)
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const panDragRef = useRef<{ dragging: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  });

  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ---- Draft annotations (local only until "Delen") ----
  const [annotate, setAnnotate] = useState(false);
  const [tool, setTool] = useState<DrawTool>("circle");
  const [draft, setDraft] = useState<DraftShape[]>([]);
  const previewRef = useRef<DraftShape | null>(null);

  const drawDragRef = useRef<{ drawing: boolean; startNX: number; startNY: number }>({
    drawing: false,
    startNX: 0,
    startNY: 0,
  });

  // ---- Hard cap pan ----
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

  // ---- cleanup / reconnect fix ----
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

    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play?.().catch(() => {});
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
    }).subscribe();
  }

  async function disconnect() {
    await cleanup();
  }

  // ---- Zoom helpers ----
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

  // ---- mapping pointer -> normalized coords ----
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

  // ---- Canvas render (draft + preview) ----
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

    function draw() {
      const c = canvasRef.current;
      const vp = viewportRef.current;
      const vid = videoRef.current;

      if (!c || !vp || !vid) {
        raf = requestAnimationFrame(draw);
        return;
      }

      resizeCanvas();
      const ctx = c.getContext("2d");
      if (!ctx) {
        raf = requestAnimationFrame(draw);
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

      // stijl
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#60a5fa";
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 6;

      for (const s of all) {
        // normalized -> viewport coords (incl pan/zoom)
        const tx = pan.x + s.x * baseW * zoom;
        const ty = pan.y + s.y * baseH * zoom;

        if (s.kind === "circle") {
          const r = s.r * Math.max(baseW, baseH) * zoom;
          ctx.beginPath();
          ctx.arc(tx, ty, r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const tw = s.w * baseW * zoom;
          const th = s.h * baseH * zoom;
          ctx.strokeRect(tx, ty, tw, th);
        }
      }

      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [draft, pan.x, pan.y, zoom]);

  // ---- Pan handlers (alleen als niet tekenen) ----
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

  // ---- Draw handlers (draft only) ----
  function onCanvasPointerDown(e: React.PointerEvent) {
    if (!annotate || !connected) return;
    (e.currentTarget as any).setPointerCapture?.(e.pointerId);

    const { nx, ny } = pointerToNormalized(e);
    drawDragRef.current = { drawing: true, startNX: nx, startNY: ny };

    previewRef.current =
      tool === "circle"
        ? { kind: "circle", x: nx, y: ny, r: 0.001 }
        : { kind: "rect", x: nx, y: ny, w: 0.001, h: 0.001 };
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
    } else {
      const x = Math.min(startX, nx);
      const y = Math.min(startY, ny);
      const w = Math.max(0.01, Math.abs(nx - startX));
      const h = Math.max(0.01, Math.abs(ny - startY));
      previewRef.current = { kind: "rect", x, y, w, h };
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

  // ---- Freeze snapshot from video ----
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
      alert("Maak eerst een cirkel of kader, of kies Wissen.");
      return;
    }
    const snapshot = captureSnapshotJpeg();
    if (!snapshot) {
      alert("Kan nog geen snapshot maken. Wacht 1 seconde en probeer opnieuw.");
      return;
    }

    const packet: DrawPacket = {
      id: uid(),
      createdAt: Date.now(),
      snapshotJpeg: snapshot,
      shapes: draft,
    };

    try {
      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "draw_packet", packet } satisfies SignalMsg,
      });

      // Na delen: draft opruimen (jij kunt dit ook “laten staan” als je wilt)
      setDraft([]);
      previewRef.current = null;
    } catch {
      alert("Delen mislukt. Probeer opnieuw.");
    }
  }

  const raw = code.replace(/\D/g, "");
  const canConnect = raw.length === 6;

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Meekijken</h1>
        <p className="text-slate-600">Vul de code in die je ouder ziet.</p>
      </header>

      <Card className="space-y-4">
        <Input
          value={code}
          onChange={(e) => setCode(formatCode(e.target.value))}
          placeholder="123 456"
          inputMode="numeric"
          autoFocus
        />

        {!connected ? (
          <Button variant="primary" className="w-full" onClick={connect} disabled={!canConnect || status === "connecting"}>
            {status === "connecting" ? "Verbinden…" : "Verbind"}
          </Button>
        ) : (
          <Button className="w-full" onClick={disconnect}>
            Stop meekijken
          </Button>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="text-sm text-slate-600">
            Status: <span className="font-mono">{status}</span>
            {remoteQuality ? (
              <>
                {" "}
                • Kwaliteit: <span className="font-mono">{remoteQuality}</span>
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={zoomOut} disabled={zoom <= 1} title="Zoom uit">
              −
            </Button>

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
            />

            <Button onClick={zoomIn} disabled={zoom >= 3} title="Zoom in">
              +
            </Button>

            <div className="text-sm text-slate-600 w-14 text-right">{Math.round(zoom * 100)}%</div>

            <Button onClick={resetView}>Reset</Button>

            <Button onClick={fullscreen}>Fullscreen</Button>
          </div>
        </div>

        {isFullscreen ? (
          <div className="mb-3 text-sm text-slate-600">
            Fullscreen actief — druk <b>ESC</b> om terug te gaan.
          </div>
        ) : null}

        {/* Aanwijzen UI (draft) */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={annotate}
              onChange={(e) => setAnnotate(e.target.checked)}
              disabled={!connected}
              title={!connected ? "Verbind eerst met de ouder" : ""}
            />
            Aantekeningen maken
          </label>

          <div className="text-sm text-slate-600">
            {annotate ? "Teken rustig, pas als het klopt klik je op ‘Delen met ouder’." : "Tip: zoom + sleep om details te bekijken"}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="text-sm text-slate-600">Tool</label>
            <select
              value={tool}
              onChange={(e) => setTool(e.target.value as DrawTool)}
              className="h-10 rounded-xl border px-3 bg-white"
              disabled={!annotate}
              title={!annotate ? "Zet Aantekeningen aan" : ""}
            >
              <option value="circle">Cirkel</option>
              <option value="rect">Kader</option>
            </select>

            <Button onClick={() => setDraft((d) => d.slice(0, -1))} disabled={!annotate || draft.length === 0} title="Undo laatste">
              Undo
            </Button>

            <Button onClick={() => setDraft([])} disabled={!annotate || draft.length === 0}>
              Wissen
            </Button>

            <Button variant="primary" onClick={shareToParent} disabled={!annotate || draft.length === 0}>
              Delen met ouder
            </Button>
          </div>
        </div>

        {/* Viewport: video + canvas overlay */}
        <div
          ref={viewportRef}
          className="rounded-xl bg-black/90 overflow-hidden"
          style={{
            width: "100%",
            position: "relative",
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
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "top left",
              width: "100%",
            }}
          >
            <video ref={videoRef} autoPlay playsInline className="w-full rounded-xl" />
          </div>

          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: annotate ? "auto" : "none",
            }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
            onPointerLeave={onCanvasPointerUp}
          />
        </div>

        {annotate ? (
          <p className="mt-3 text-sm text-slate-600">
            Je ouder ziet pas iets nadat jij op <b>Delen met ouder</b> klikt.
          </p>
        ) : null}
      </Card>
    </main>
  );
}
