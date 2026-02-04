"use client";

import type React from "react";
import { useMemo, useRef, useState, useEffect } from "react";
import { Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

import FullscreenShell from "@/components/meekijk/FullscreenShell";
import ViewerStage from "@/components/meekijk/ViewerStage";

type Quality = "low" | "medium" | "high";
type DrawTool = "circle" | "rect" | "arrow";
type ActiveSource = "screen" | "camera" | "none";

type DraftShape =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number };

type DrawPacket = {
  id: string;
  createdAt: number;
  snapshotJpeg: string;
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

// camera channel messages (telefoon)
type CamSignalMsg =
  | { type: "hello"; at: number }
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any };

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

  const [useKoppelcode, setUseKoppelcode] = useState<boolean>(true);
  const [activeSessions, setActiveSessions] = useState<{ id: string; code: string; created_at?: string }[]>([]);
  const [activeError, setActiveError] = useState<string | null>(null);

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [remoteQuality, setRemoteQuality] = useState<Quality | null>(null);

  // ✅ actief bron-signaal vanuit ouder
  const [activeSource, setActiveSource] = useState<ActiveSource>("screen");

  // screen video
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // phone camera video
  const camVideoRef = useRef<HTMLVideoElement | null>(null);
  const camPcRef = useRef<RTCPeerConnection | null>(null);
  const camChannelRef = useRef<any>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);

  const [needsTapToPlay, setNeedsTapToPlay] = useState(false);
  const [needsTapToPlayCam, setNeedsTapToPlayCam] = useState(false);

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
    if (!vp) return nextPan;

    const vpW = vp.clientWidth || 0;
    const vpH = vp.clientHeight || 0;
    if (!vpW || !vpH) return nextPan;

    const scaledW = vpW * nextZoom;
    const scaledH = vpH * nextZoom;

    const minX = Math.min(0, vpW - scaledW);
    const minY = Math.min(0, vpH - scaledH);

    return { x: clamp(nextPan.x, minX, 0), y: clamp(nextPan.y, minY, 0) };
  }

  useEffect(() => {
    setPan((p) => clampPan(p, zoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  async function cleanup() {
    // screen pc + channel
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

    // camera pc + channel
    try {
      camPcRef.current?.close();
    } catch {}
    camPcRef.current = null;

    try {
      if (camChannelRef.current) await supabase.removeChannel(camChannelRef.current);
    } catch {}
    camChannelRef.current = null;

    if (camVideoRef.current) {
      try {
        (camVideoRef.current as any).srcObject = null;
      } catch {}
    }

    setNeedsTapToPlay(false);
    setNeedsTapToPlayCam(false);
    setConnected(false);
    setStatus("idle");
    setRemoteQuality(null);
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
      setActiveSessions(Array.isArray(j?.sessions) ? j.sessions : []);
    } catch {
      setActiveSessions([]);
      setActiveError("Kan actieve sessies niet laden.");
    }
  }

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("use_koppelcode")
        .eq("id", user.id)
        .maybeSingle<{ use_koppelcode: boolean | null }>();

      const flag = prof?.use_koppelcode ?? true;
      setUseKoppelcode(flag);

      if (flag === false) {
        await refreshActiveSessions();
      } else {
        setActiveSessions([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setupCameraReceiver(raw: string) {
    // cleanup old
    try {
      camPcRef.current?.close();
    } catch {}
    camPcRef.current = null;
    try {
      if (camChannelRef.current) await supabase.removeChannel(camChannelRef.current);
    } catch {}
    camChannelRef.current = null;

    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    camPcRef.current = pc;

    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (!stream) return;
      const v = camVideoRef.current;
      if (!v) return;

      setNeedsTapToPlayCam(false);
      v.srcObject = stream;
      v.muted = true;
      v.playsInline = true;
      v.disablePictureInPicture = true;

      const tryPlay = async () => {
        try {
          await v.play();
          setNeedsTapToPlayCam(false);
        } catch {
          setNeedsTapToPlayCam(true);
        }
      };
      void tryPlay();
      v.onloadedmetadata = () => void tryPlay();
    };

    const ch = supabase.channel(`signalcam:${raw}`);
    camChannelRef.current = ch;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        ch.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "ice", candidate: e.candidate } satisfies CamSignalMsg,
        });
      }
    };

    ch.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as CamSignalMsg;

      try {
        if (!camPcRef.current) return;

        if (msg.type === "offer") {
          await camPcRef.current.setRemoteDescription(msg.sdp);
          const answer = await camPcRef.current.createAnswer();
          await camPcRef.current.setLocalDescription(answer);

          await ch.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "answer", sdp: answer } satisfies CamSignalMsg,
          });
        } else if (msg.type === "ice") {
          await camPcRef.current.addIceCandidate(msg.candidate);
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
          payload: { type: "hello", at: Date.now() } satisfies CamSignalMsg,
        });
      }
    });
  }

  async function connect(rawOverride?: string) {
    const raw = String(rawOverride ?? code).replace(/\D/g, "");
    if (raw.length !== 6) return alert("Vul 6 cijfers in.");

    await cleanup();
    setStatus("connecting");

    // Setup BOTH receivers:
    // - screen: signal:${raw}
    // - camera: signalcam:${raw}
    await setupCameraReceiver(raw);

    const ch = supabase.channel(`signal:${raw}`);
    channelRef.current = ch;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (!stream) return;

      const v = videoRef.current;
      if (!v) return;

      setNeedsTapToPlay(false);
      v.srcObject = stream;
      v.muted = true;
      v.playsInline = true;
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
        } else if (msg.type === "active_source") {
          setActiveSource(msg.source);
        }
      } catch (e) {
        console.error(e);
        setStatus("error");
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
      const el = activeSource === "camera" ? camVideoRef.current : videoRef.current;
      if (!el) return;
      await (el as any).requestFullscreen?.();
    } catch {}
  }

  function pointerToNormalized(e: React.PointerEvent) {
    const vp = viewportRef.current;
    if (!vp) return { nx: 0, ny: 0 };

    const rect = vp.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const vpW = vp.clientWidth || 1;
    const vpH = vp.clientHeight || 1;

    const ux = (px - pan.x) / zoom;
    const uy = (py - pan.y) / zoom;

    const nx = clamp(ux / vpW, 0, 1);
    const ny = clamp(uy / vpH, 0, 1);
    return { nx, ny };
  }

  // Canvas render (DPR sharp)
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
      if (!c || !vp) {
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

      const all = [...draft];
      if (previewRef.current) all.push(previewRef.current);

      ctx.lineWidth = 4;
      ctx.strokeStyle = "#60a5fa";
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 6;

      for (const s of all) {
        if (s.kind === "circle") {
          const tx = pan.x + s.x * w * zoom;
          const ty = pan.y + s.y * h * zoom;
          const r = s.r * Math.max(w, h) * zoom;
          ctx.beginPath();
          ctx.arc(tx, ty, r, 0, Math.PI * 2);
          ctx.stroke();
        } else if (s.kind === "rect") {
          const x = pan.x + s.x * w * zoom;
          const y = pan.y + s.y * h * zoom;
          const rw = s.w * w * zoom;
          const rh = s.h * h * zoom;
          ctx.strokeRect(x, y, rw, rh);
        } else {
          const x1 = pan.x + s.x1 * w * zoom;
          const y1 = pan.y + s.y1 * h * zoom;
          const x2 = pan.x + s.x2 * w * zoom;
          const y2 = pan.y + s.y2 * h * zoom;
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
    const v = activeSource === "camera" ? camVideoRef.current : videoRef.current;
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

  // ========== UI ==========
  return (
    <FullscreenShell
      sidebar={
        <div className="p-4 space-y-3">
          <div className="text-sm font-semibold">Kind – verbinden</div>

          {useKoppelcode ? (
            <>
              <div className="text-xs text-slate-600">
                Vul de 6-cijferige code in die je van je ouder hebt gekregen.
              </div>

              <Input value={formatCode(code)} onChange={(e) => setCode(e.target.value)} placeholder="123 456" />

              <div className="flex gap-2">
                <Button variant="primary" onClick={() => connect()} disabled={!canConnect || status === "connecting"} className="flex-1">
                  Verbinden
                </Button>
                <Button onClick={disconnect} disabled={status === "idle"} className="w-28">
                  Stop
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-slate-600">Actieve sessies die al aan jou zijn toegewezen:</div>
              {activeError ? <div className="text-xs text-red-600">{activeError}</div> : null}
              <div className="space-y-2">
                {activeSessions.map((s) => (
                  <Button key={s.id} onClick={() => connect(s.code)} className="w-full">
                    Meekijken: {s.code}
                  </Button>
                ))}
                {activeSessions.length === 0 ? <div className="text-xs text-slate-500">Geen actieve sessies.</div> : null}
              </div>

              <div className="pt-2">
                <Button onClick={refreshActiveSessions} className="w-full">
                  Vernieuwen
                </Button>
              </div>
            </>
          )}

          <div className="pt-2 text-xs text-slate-600">
            Status: <span className="font-semibold">{status}</span>
          </div>

          <div className="text-xs text-slate-600">
            Ouder toont:{" "}
            <span className="font-semibold">
              {activeSource === "camera" ? "Telefoon" : activeSource === "screen" ? "Scherm" : "Niets"}
            </span>
          </div>

          {remoteQuality ? (
            <div className="text-xs text-slate-600">
              Kwaliteit: <span className="font-semibold">{remoteQuality}</span>
            </div>
          ) : null}

          <div className="pt-2 flex gap-2 flex-wrap">
            <Button onClick={zoomOut} disabled={zoom <= 1}>
              −
            </Button>
            <Button onClick={zoomIn} disabled={zoom >= 3}>
              +
            </Button>
            <Button onClick={resetView} disabled={zoom === 1 && pan.x === 0 && pan.y === 0}>
              Reset
            </Button>
            <Button onClick={fullscreen} className="ml-auto">
              Fullscreen
            </Button>
          </div>

          <div className="pt-2 rounded-xl border p-3">
            <div className="text-xs font-semibold">Aanwijzen / tekenen</div>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={annotate} onChange={(e) => setAnnotate(e.target.checked)} />
              Aan
            </label>

            <div className="mt-2 flex gap-2">
              <Button onClick={() => setTool("circle")} variant={tool === "circle" ? "primary" : "secondary"}>
                Cirkel
              </Button>
              <Button onClick={() => setTool("rect")} variant={tool === "rect" ? "primary" : "secondary"}>
                Kader
              </Button>
              <Button onClick={() => setTool("arrow")} variant={tool === "arrow" ? "primary" : "secondary"}>
                Pijl
              </Button>
            </div>

            <div className="mt-3 flex gap-2">
              <Button onClick={shareToParent} disabled={!connected || draft.length === 0} className="flex-1" variant="primary">
                Delen
              </Button>
              <Button onClick={() => setDraft([])} disabled={draft.length === 0} className="w-28">
                Reset
              </Button>
            </div>

            <div className="mt-2 text-[11px] text-slate-500">
              Tip: zoom in om precies te tekenen. Pan werkt alleen als annotatie uit staat.
            </div>
          </div>
        </div>
      }
    >
      <div className="h-screen w-screen bg-black">
        <ViewerStage>
          <div className="h-full w-full">
            {/* Groot meekijk vlak (zelfde plek voor screen of camera) */}
            <div
              ref={viewportRef}
              className="relative h-full w-full overflow-hidden bg-black"
              onPointerDown={onViewportPointerDown}
              onPointerMove={onViewportPointerMove}
              onPointerUp={onViewportPointerUp}
              onPointerCancel={onViewportPointerUp}
            >
              {/* Screen video */}
              <video
                ref={videoRef}
                className={`absolute inset-0 h-full w-full ${activeSource === "screen" ? "block" : "hidden"}`}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "top left",
                }}
              />

              {/* Camera video */}
              <video
                ref={camVideoRef}
                className={`absolute inset-0 h-full w-full ${activeSource === "camera" ? "block" : "hidden"}`}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "top left",
                  objectFit: "cover",
                }}
              />

              {/* Placeholder */}
              {activeSource === "none" ? (
                <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
                  Geen actieve bron. Vraag je ouder om scherm of telefoon te tonen.
                </div>
              ) : null}

              {/* Tap to play overlay (iOS) */}
              {needsTapToPlay && activeSource === "screen" ? (
                <button
                  onClick={() => videoRef.current?.play?.().catch(() => {})}
                  className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-sm"
                >
                  Tik om video te starten
                </button>
              ) : null}

              {needsTapToPlayCam && activeSource === "camera" ? (
                <button
                  onClick={() => camVideoRef.current?.play?.().catch(() => {})}
                  className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-sm"
                >
                  Tik om camera te starten
                </button>
              ) : null}

              {/* Annotation canvas */}
              <canvas
                ref={canvasRef}
                className="absolute inset-0"
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={onCanvasPointerUp}
                onPointerCancel={onCanvasPointerUp}
                style={{ touchAction: "none" }}
              />
            </div>
          </div>
        </ViewerStage>
      </div>
    </FullscreenShell>
  );
}
