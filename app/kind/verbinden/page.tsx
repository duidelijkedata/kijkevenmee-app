"use client";

import type React from "react";
import { useMemo, useRef, useState, useEffect } from "react";
import { Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

import FullscreenShell from "@/components/meekijk/FullscreenShell";
import ViewerStage from "@/components/meekijk/ViewerStage";

type Quality = "low" | "medium" | "high";
type ActiveSource = "screen" | "camera" | "none";
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

export default function KindVerbindenPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [connected, setConnected] = useState(false);

  const [remoteQuality, setRemoteQuality] = useState<Quality | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);

  // ✅ extra: telefoon-camera stream (direct naar kind)
  const pcCamRef = useRef<RTCPeerConnection | null>(null);
  const channelCamRef = useRef<any>(null);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);

  const [activeSource, setActiveSource] = useState<ActiveSource>("screen");
  const activeSourceRef = useRef<ActiveSource>("screen");

  const [needsTapToPlay, setNeedsTapToPlay] = useState(false);

  // Zoom + pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // Hard cap op pan
  const PAN_CAP = 800;

  // Tekenen
  const [tool, setTool] = useState<DrawTool>("circle");
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<DraftShape | null>(null);
  const [shapes, setShapes] = useState<DraftShape[]>([]);

  // Snapshot queue
  const [sending, setSending] = useState(false);
  const sendTimerRef = useRef<any>(null);

  function applyActiveSourceToVideo(source: ActiveSource) {
    const v = videoRef.current;
    if (!v) return;

    const next =
      source === "camera"
        ? camStreamRef.current
        : source === "screen"
          ? screenStreamRef.current
          : null;

    if (next) {
      v.srcObject = next;
      v.muted = true;
      v.playsInline = true;
      // @ts-ignore
      v.disablePictureInPicture = true;
      v.play?.().catch(() => setNeedsTapToPlay(true));
    } else {
      try {
        (v as any).srcObject = null;
      } catch {}
    }
  }

  function setActiveSourceLocal(source: ActiveSource) {
    activeSourceRef.current = source;
    setActiveSource(source);
    applyActiveSourceToVideo(source);
  }

  async function cleanup() {
    // screen pc
    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;

    // camera pc
    try {
      pcCamRef.current?.close();
    } catch {}
    pcCamRef.current = null;

    // realtime channels
    try {
      if (channelRef.current) await supabase.removeChannel(channelRef.current);
    } catch {}
    channelRef.current = null;

    try {
      if (channelCamRef.current) await supabase.removeChannel(channelCamRef.current);
    } catch {}
    channelCamRef.current = null;

    screenStreamRef.current = null;
    camStreamRef.current = null;

    if (videoRef.current) {
      try {
        (videoRef.current as any).srcObject = null;
      } catch {}
    }

    setNeedsTapToPlay(false);
    setConnected(false);
    setStatus("idle");
    setRemoteQuality(null);
    setActiveSourceLocal("screen");
  }

  useEffect(() => {
    return () => {
      void cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect(rawOverride?: string) {
    const raw = String(rawOverride ?? code).replace(/\D/g, "");
    if (raw.length !== 6) return alert("Vul 6 cijfers in.");

    await cleanup();
    setStatus("connecting");

    // ===== Screen channel + PC =====
    const ch = supabase.channel(`signal:${raw}`);
    channelRef.current = ch;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (!stream) return;

      screenStreamRef.current = stream;

      // als we NIET op camera staan, toon scherm
      if (activeSourceRef.current !== "camera") {
        const v = videoRef.current;
        if (!v) return;

        setNeedsTapToPlay(false);

        v.srcObject = stream;
        v.muted = true;
        v.playsInline = true;
        // @ts-ignore
        v.disablePictureInPicture = true;

        v.play?.().catch(() => setNeedsTapToPlay(true));
      }
    };

    pc.onicecandidate = async (e) => {
      if (e.candidate) {
        await ch.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "ice", candidate: e.candidate } satisfies SignalMsg,
        });
      }
    };

    ch.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;

      try {
        if (msg.type === "active_source") {
          setActiveSourceLocal(msg.source);
          return;
        }

        // de rest hoort bij screenshare pc
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

          setConnected(true);
          setStatus("connected");

          // kind zegt hallo zodat ouder evt offer opnieuw kan sturen
          await ch.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "hello", at: Date.now() } satisfies SignalMsg,
          });

          return;
        }

        if (msg.type === "ice") {
          await pcRef.current.addIceCandidate(msg.candidate);
          return;
        }

        if (msg.type === "quality") {
          setRemoteQuality(msg.quality);
          return;
        }
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    });

    await ch.subscribe();

    // ===== Camera channel + PC (telefoon -> kind) =====
    const chCam = supabase.channel(`signalcam:${raw}`);
    channelCamRef.current = chCam;

    const pcCam = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcCamRef.current = pcCam;

    pcCam.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (!stream) return;

      camStreamRef.current = stream;

      // als we WEL op camera staan, toon camera
      if (activeSourceRef.current === "camera") {
        const v = videoRef.current;
        if (!v) return;

        setNeedsTapToPlay(false);

        v.srcObject = stream;
        v.muted = true;
        v.playsInline = true;
        // @ts-ignore
        v.disablePictureInPicture = true;

        v.play?.().catch(() => setNeedsTapToPlay(true));
      }
    };

    pcCam.onicecandidate = async (e) => {
      if (e.candidate) {
        await chCam.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "ice", candidate: e.candidate } satisfies SignalMsg,
        });
      }
    };

    chCam.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;

      try {
        if (!pcCamRef.current) return;

        if (msg.type === "offer") {
          await pcCamRef.current.setRemoteDescription(msg.sdp);
          const answer = await pcCamRef.current.createAnswer();
          await pcCamRef.current.setLocalDescription(answer);

          await chCam.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "answer", sdp: answer } satisfies SignalMsg,
          });
          return;
        }

        if (msg.type === "ice") {
          await pcCamRef.current.addIceCandidate(msg.candidate);
          return;
        }
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    });

    await chCam.subscribe();

    // default source op screen totdat ouder anders zegt
    setActiveSourceLocal("screen");
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

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    if (delta > 0) zoomOut();
    else zoomIn();
  }

  function onMouseDown(e: React.MouseEvent) {
    if (zoom <= 1) return;
    setDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    const nx = clamp(dragStartRef.current.panX + dx, -PAN_CAP, PAN_CAP);
    const ny = clamp(dragStartRef.current.panY + dy, -PAN_CAP, PAN_CAP);

    setPan({ x: nx, y: ny });
  }
  function onMouseUp() {
    setDragging(false);
    dragStartRef.current = null;
  }

  function drawStart(e: React.MouseEvent) {
    if (!connected) return;
    if (!viewportRef.current) return;
    if (!canvasRef.current) return;

    const rect = viewportRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;

    setDrawing(true);

    if (tool === "circle") {
      setDraft({ kind: "circle", x, y, r: 1 });
    } else if (tool === "rect") {
      setDraft({ kind: "rect", x, y, w: 1, h: 1 });
    } else {
      setDraft({ kind: "arrow", x1: x, y1: y, x2: x, y2: y });
    }
  }

  function drawMove(e: React.MouseEvent) {
    if (!drawing || !draft) return;
    if (!viewportRef.current) return;

    const rect = viewportRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;

    if (draft.kind === "circle") {
      const r = Math.max(2, Math.hypot(x - draft.x, y - draft.y));
      setDraft({ ...draft, r });
    } else if (draft.kind === "rect") {
      setDraft({ ...draft, w: x - draft.x, h: y - draft.y });
    } else if (draft.kind === "arrow") {
      setDraft({ ...draft, x2: x, y2: y });
    }
  }

  function drawEnd() {
    if (!drawing) return;
    setDrawing(false);
    if (draft) {
      setShapes((prev) => [...prev, draft]);
      setDraft(null);
      scheduleSend();
    }
  }

  function clearShapes() {
    setShapes([]);
    setDraft(null);
  }

  async function sendPacketNow() {
    if (!channelRef.current) return;
    if (!videoRef.current) return;

    if (sending) return;
    setSending(true);

    try {
      const v = videoRef.current;
      const canvas = document.createElement("canvas");

      const w = Math.max(320, Math.min(1280, v.videoWidth || 1280));
      const h = Math.max(240, Math.min(720, v.videoHeight || 720));

      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(v, 0, 0, w, h);

      const snapshotJpeg = canvas.toDataURL("image/jpeg", 0.65);

      const packet: DrawPacket = {
        id: uid(),
        createdAt: Date.now(),
        snapshotJpeg,
        shapes: shapes.slice(),
      };

      await channelRef.current.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "draw_packet", packet } satisfies SignalMsg,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  }

  function scheduleSend() {
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
    sendTimerRef.current = setTimeout(() => {
      void sendPacketNow();
    }, 220);
  }

  useEffect(() => {
    // overlay canvas tekenen
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const v = videoRef.current;
      const vp = viewportRef.current;
      if (!v || !vp) {
        requestAnimationFrame(draw);
        return;
      }

      const rect = vp.getBoundingClientRect();
      const cw = Math.max(1, Math.floor(rect.width));
      const ch = Math.max(1, Math.floor(rect.height));

      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;

      ctx.clearRect(0, 0, cw, ch);

      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      ctx.lineWidth = 6;
      ctx.strokeStyle = "#ff3b30";
      ctx.fillStyle = "rgba(255,59,48,0.15)";

      const list = [...shapes, ...(draft ? [draft] : [])];
      for (const s of list) {
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

      ctx.restore();

      requestAnimationFrame(draw);
    };

    draw();
  }, [zoom, pan, shapes, draft]);

  return (
    <FullscreenShell sidebar={null}>
      <div className="h-screen w-screen bg-black">
        <ViewerStage>
          <div className="h-full w-full grid grid-cols-1 lg:grid-cols-[360px_1fr]">
            {/* LEFT */}
            <div className="min-w-0 border-b lg:border-b-0 lg:border-r border-white/10">
              <div className="p-3 flex flex-col gap-3">
                <div className="text-white text-sm font-semibold">Kind – meekijken</div>

                <div className="rounded-xl bg-white/10 p-3 text-white text-sm">
                  <div className="text-xs opacity-80 mb-2">Koppelcode</div>
                  <Input value={code} onChange={(e) => setCode(formatCode(e.target.value))} placeholder="123 456" />
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="primary"
                      onClick={() => void connect()}
                      disabled={status === "connecting" || connected}
                      className="flex-1"
                    >
                      Verbinden
                    </Button>
                    <Button onClick={() => void disconnect()} disabled={status === "connecting"} className="w-28">
                      Stop
                    </Button>
                  </div>
                  <div className="mt-2 text-xs opacity-80">
                    Status:{" "}
                    <span className="font-semibold">
                      {status === "connecting" ? "Verbinden…" : status === "connected" ? "Verbonden" : status === "error" ? "Fout" : "Idle"}
                    </span>
                  </div>
                  {remoteQuality ? (
                    <div className="mt-1 text-xs opacity-80">Ouder kwaliteit: <span className="font-semibold">{remoteQuality}</span></div>
                  ) : null}
                  <div className="mt-1 text-xs opacity-80">
                    Bron:{" "}
                    <span className="font-semibold">
                      {activeSource === "camera" ? "Telefoon" : activeSource === "screen" ? "PC-scherm" : "Niets"}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl bg-white/10 p-3 text-white text-sm">
                  <div className="font-semibold">Tekenen</div>
                  <div className="mt-2 flex gap-2 flex-wrap">
                    <Button variant={tool === "circle" ? "primary" : "secondary"} onClick={() => setTool("circle")}>
                      Cirkel
                    </Button>
                    <Button variant={tool === "rect" ? "primary" : "secondary"} onClick={() => setTool("rect")}>
                      Rechthoek
                    </Button>
                    <Button variant={tool === "arrow" ? "primary" : "secondary"} onClick={() => setTool("arrow")}>
                      Pijl
                    </Button>
                    <Button onClick={clearShapes}>Wissen</Button>
                  </div>

                  {needsTapToPlay ? (
                    <div className="mt-3 rounded-xl border border-white/20 bg-white/5 p-3 text-xs">
                      Video play blocked. Tik op de video om te starten.
                    </div>
                  ) : null}
                </div>

                <div className="rounded-xl bg-white/10 p-3 text-white text-xs opacity-80">
                  Zoom: {zoom.toFixed(2)} • Pan cap: {PAN_CAP}px
                </div>
              </div>
            </div>

            {/* RIGHT (video) */}
            <div className="min-w-0">
              <div
                ref={viewportRef}
                className="relative h-full w-full flex items-center justify-center overflow-hidden bg-black"
                onWheel={onWheel}
                onMouseDown={(e) => {
                  if (tool) drawStart(e);
                }}
                onMouseMove={(e) => {
                  drawMove(e);
                  onMouseMove(e);
                }}
                onMouseUp={() => {
                  drawEnd();
                  onMouseUp();
                }}
                onMouseLeave={() => {
                  drawEnd();
                  onMouseUp();
                }}
                onContextMenu={(e) => e.preventDefault()}
              >
                <div
                  className="absolute inset-0"
                  onMouseDown={onMouseDown}
                  onMouseMove={onMouseMove}
                  onMouseUp={onMouseUp}
                />

                <video
                  ref={videoRef}
                  className="max-h-full max-w-full select-none"
                  onClick={() => {
                    if (!videoRef.current) return;
                    videoRef.current.play?.().catch(() => {});
                    setNeedsTapToPlay(false);
                  }}
                />

                <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
              </div>
            </div>
          </div>
        </ViewerStage>
      </div>
    </FullscreenShell>
  );
}
