"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

import FullscreenShell from "@/components/meekijk/FullscreenShell";
import ViewerStage from "@/components/meekijk/ViewerStage";

type Quality = "low" | "medium" | "high";
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
  | { type: "active_source"; source: ActiveSource }
  | { type: "cam_preview"; jpeg: string; at: number };

type PacketState = DrawPacket & { seen: boolean };

function qualityLabel(q: Quality) {
  if (q === "low") return "Lage Kwaliteit";
  if (q === "medium") return "Normale Kwaliteit";
  return "Hoge Kwaliteit";
}

function qualitySubtitle(q: Quality) {
  if (q === "low") return "Stabiel, minder data";
  if (q === "medium") return "Gebalanceerd beeld";
  return "Scherpst, meeste data";
}

function qualityParams(q: Quality) {
  if (q === "low") return { maxBitrate: 2_500_000, idealFps: 15, maxFps: 20 };
  if (q === "medium") return { maxBitrate: 8_000_000, idealFps: 30, maxFps: 30 };
  return { maxBitrate: 12_000_000, idealFps: 30, maxFps: 60 };
}

function statusChip(status: "idle" | "sharing" | "connected" | "error") {
  if (status === "connected" || status === "sharing") {
    return {
      label: "Systeem is Gereed",
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      dot: "bg-emerald-500",
      border: "border-emerald-100",
    };
  }
  if (status === "error") {
    return {
      label: "Verbinding probleem",
      bg: "bg-red-50",
      text: "text-red-700",
      dot: "bg-red-500",
      border: "border-red-100",
    };
  }
  return {
    label: "Niet actief",
    bg: "bg-slate-50",
    text: "text-slate-600",
    dot: "bg-slate-400",
    border: "border-slate-200",
  };
}

export default function ShareClient({ code }: { code: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [status, setStatus] = useState<"idle" | "sharing" | "connected" | "error">("idle");

  const [quality, setQuality] = useState<Quality>("medium");
  const [auto, setAuto] = useState(true);
  const [debugLine, setDebugLine] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const channelRef = useRef<any>(null);
  const lastOfferRef = useRef<any>(null);

  const statsTimerRef = useRef<any>(null);
  const lastBytesSentRef = useRef<number | null>(null);
  const lastStatsAtRef = useRef<number | null>(null);

  const [packets, setPackets] = useState<PacketState[]>([]);
  const [activePacketId, setActivePacketId] = useState<string | null>(null);

  const snapshotModalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);

  useEffect(() => {
    if (!snapshotModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSnapshotModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snapshotModalOpen]);

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://kijkevenmee-app.vercel.app";

  // ====== Telefoon camera overlay ======
  const [camOpen, setCamOpen] = useState(false);
  const [camLoading, setCamLoading] = useState(false);
  const [camError, setCamError] = useState<string>("");
  const [camLink, setCamLink] = useState<string>("");

  const [activeSource, setActiveSource] = useState<ActiveSource>("screen");

  // preview frames (jpeg frames via broadcast)
  const [camPreviewJpeg, setCamPreviewJpeg] = useState<string>("");
  const [camPreviewAt, setCamPreviewAt] = useState<number>(0);

  // overlay is live zodra we echt frames ontvangen
  const [camLive, setCamLive] = useState<boolean>(false);
  const phoneIsLive = camLive;

  // helper: "telefoon is *nu* live" (dus geen QR nodig)
  function phoneIsLiveNow() {
    if (!camLive) return false;
    if (!camPreviewAt) return false;
    const age = Date.now() - camPreviewAt;
    // preview komt op telefoon ~2fps; als we < 4s oud zijn is hij vrijwel zeker nog live
    return age < 4000;
  }

  async function broadcastActiveSource(source: ActiveSource) {
    setActiveSource(source);
    try {
      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "active_source", source } satisfies SignalMsg,
      });
    } catch {}
  }

  function qrUrl(data: string) {
    const size = "240x240";
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}&data=${encodeURIComponent(data)}`;
  }

  async function createPhoneCameraLink() {
    setCamLoading(true);
    setCamError("");
    setCamLink("");

    try {
      const res = await fetch(`/api/support/${encodeURIComponent(code)}/camera-token`, { method: "POST" });
      const json = await res.json();

      if (!res.ok) {
        setCamError(json?.error || "Kon telefoon-link niet maken.");
        setCamLoading(false);
        return;
      }

      const url = `${origin}/ouder/camera?token=${encodeURIComponent(json.token)}`;
      setCamLink(url);
      setCamLoading(false);
    } catch {
      setCamError("Netwerkfout bij aanmaken telefoon-link.");
      setCamLoading(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }

  // ===== Signaling =====
  useEffect(() => {
    const ch = supabase.channel(`signal:${code}`);
    channelRef.current = ch;

    ch.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;

      try {
        if (msg.type === "hello") {
          if (lastOfferRef.current) {
            await ch.send({
              type: "broadcast",
              event: "signal",
              payload: { type: "offer", sdp: lastOfferRef.current } satisfies SignalMsg,
            });
          }
          return;
        }

        if (msg.type === "cam_preview") {
          setCamPreviewJpeg(msg.jpeg);
          setCamPreviewAt(msg.at || Date.now());
          setCamLive(true);
          return;
        }

        if (msg.type === "active_source") {
          setActiveSource(msg.source);
          return;
        }

        if (msg.type === "draw_packet") {
          const packet = msg.packet;
          setPackets((prev) => [...prev, { ...packet, seen: document.visibilityState === "visible" }]);
          setActivePacketId(packet.id);
          return;
        }

        const pc = pcRef.current;
        if (!pc) return;

        if (msg.type === "answer") {
          await pc.setRemoteDescription(msg.sdp);
          setStatus("connected");
          return;
        }

        if (msg.type === "ice") {
          await pc.addIceCandidate(msg.candidate);
          return;
        }
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    });

    ch.subscribe();

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {}
    };
  }, [supabase, code]);

  async function broadcastQuality(q: Quality) {
    try {
      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "quality", quality: q } satisfies SignalMsg,
      });
    } catch {}
  }

  async function applySenderQuality(pc: RTCPeerConnection, q: Quality) {
    const { maxBitrate, idealFps, maxFps } = qualityParams(q);
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;

    const params = sender.getParameters();
    params.encodings = params.encodings || [{}];

    params.encodings[0].maxBitrate = maxBitrate;
    params.encodings[0].maxFramerate = maxFps;
    // @ts-ignore
    params.encodings[0].scaleResolutionDownBy = 1;
    // @ts-ignore
    params.degradationPreference = "maintain-resolution";

    await sender.setParameters(params);
    await broadcastQuality(q);

    try {
      const t = sender.track as any;
      if (t?.applyConstraints) {
        await t.applyConstraints({ frameRate: { ideal: idealFps, max: maxFps } });
      }
    } catch {}
  }

  function stopStatsLoop() {
    if (statsTimerRef.current) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
    lastBytesSentRef.current = null;
    lastStatsAtRef.current = null;
    setDebugLine("");
  }

  function startStatsLoop() {
    stopStatsLoop();

    statsTimerRef.current = setInterval(async () => {
      try {
        const pc = pcRef.current;
        if (!pc) return;

        const stats = await pc.getStats();
        let outbound: any = null;

        stats.forEach((r) => {
          if (r.type === "outbound-rtp" && (r as any).kind === "video") outbound = r;
        });

        if (!outbound) return;

        const now = Date.now();
        const bytesSent = outbound.bytesSent || 0;

        if (lastBytesSentRef.current != null && lastStatsAtRef.current != null) {
          const dt = (now - lastStatsAtRef.current) / 1000;
          const db = bytesSent - lastBytesSentRef.current;
          const mbps = (db * 8) / (dt * 1_000_000);

          const fps = outbound.framesPerSecond ? ` • ${Math.round(outbound.framesPerSecond)}fps` : "";
          setDebugLine(`${mbps.toFixed(1)} Mbps${fps}`);
        }

        lastBytesSentRef.current = bytesSent;
        lastStatsAtRef.current = now;
      } catch {}
    }, 1200);
  }

  async function stopShare() {
    stopStatsLoop();

    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;

    try {
      streamRef.current?.getTracks()?.forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;

    setStatus("idle");
  }

  async function startShare() {
    await stopShare();
    setStatus("sharing");

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate && channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "ice", candidate: e.candidate } satisfies SignalMsg,
        });
      }
    };

    try {
      const qp = qualityParams(quality);

      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: qp.idealFps, max: qp.maxFps },
        },
        audio: false,
      });

      const track = stream.getVideoTracks()[0];
      track.addEventListener("ended", () => stopShare());

      try {
        (track as any).contentHint = "text";
      } catch {}

      try {
        await (track as any).applyConstraints?.({
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: qp.idealFps, max: qp.maxFps },
        });
      } catch {}

      streamRef.current = stream;
      pc.addTrack(track, stream);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      lastOfferRef.current = offer;

      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "offer", sdp: offer } satisfies SignalMsg,
      });

      await applySenderQuality(pc, quality);

      setStatus("sharing");
      startStatsLoop();

      await broadcastActiveSource("screen");
    } catch (e) {
      console.error(e);
      setStatus("error");
      await stopShare();
    }
  }

  function drawPacketToCanvas(packet: PacketState, canvas: HTMLCanvasElement | null) {
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 1280;
      const h = img.naturalHeight || 720;
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      ctx.lineWidth = 6;
      ctx.strokeStyle = "#ff3b30";
      ctx.fillStyle = "rgba(255,59,48,0.15)";

      for (const s of packet.shapes) {
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
    };
    img.src = packet.snapshotJpeg;
  }

  // ===== Snapshot modal rendering =====
  useEffect(() => {
    if (!activePacketId) return;
    const p = packets.find((x) => x.id === activePacketId);
    if (!p) return;

    setPackets((prev) => prev.map((x) => (x.id === p.id ? { ...x, seen: true } : x)));
    if (snapshotModalOpen) drawPacketToCanvas(p, snapshotModalCanvasRef.current);
  }, [activePacketId, packets, snapshotModalOpen]);

  async function stopUsingPhoneAndReturnToScreen() {
    await broadcastActiveSource("screen");
    setCamOpen(false);

    setCamLive(false);
    setCamPreviewJpeg("");
    setCamPreviewAt(0);

    if (status === "idle") {
      await startShare();
    }
  }

  const chip = statusChip(status);
  const isActive = status === "connected" || status === "sharing";
  const mostRecent = packets.length ? packets[packets.length - 1] : null;
  const earlier = packets.length > 1 ? packets.slice(0, -1).slice(-4) : [];

  return (
    <FullscreenShell sidebar={null}>
      {/* ====== Telefoon overlay ====== */}
      {camOpen ? (
        <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">Telefoon als extra camera</div>
                <div className="text-sm text-slate-600 mt-1">
                  {phoneIsLive ? "Live beeld is actief. Je ziet hier wat het kind ziet." : "Scan de QR-code met je telefoon en start daar de camera."}
                </div>
              </div>
              <button
                className="h-10 w-10 rounded-xl border bg-white hover:bg-slate-50"
                onClick={() => setCamOpen(false)}
                aria-label="Sluiten"
              >
                ✕
              </button>
            </div>

            {phoneIsLive ? (
              <div className="mt-4 rounded-2xl border bg-slate-50 p-3">
                <div className="text-xs text-slate-600 mb-2 flex items-center justify-between">
                  <span>
                    Live preview{" "}
                    {camPreviewAt ? <span className="text-slate-400">• {new Date(camPreviewAt).toLocaleTimeString()}</span> : null}
                  </span>
                  <span className="text-slate-400">portrait</span>
                </div>

                <div className="mx-auto w-full max-w-[280px]">
                  <div className="relative w-full aspect-[9/16] rounded-2xl overflow-hidden bg-black">
                    {camPreviewJpeg ? (
                      <img src={camPreviewJpeg} alt="Live preview" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
                        Wacht op het eerste beeld…
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  <Button variant="primary" onClick={stopUsingPhoneAndReturnToScreen} className="flex-1">
                    Stop gebruik telefoon
                  </Button>
                </div>

                <div className="mt-2 text-[11px] text-slate-500">
                  Dit schakelt het kind automatisch terug naar jouw PC-scherm (en start schermdelen als dat nog niet aan staat).
                </div>
              </div>
            ) : (
              <>
                <div className="mt-4">
                  {!camLink ? (
                    <div className="flex items-center justify-between gap-3">
                      <Button variant="primary" onClick={createPhoneCameraLink} disabled={camLoading}>
                        {camLoading ? "Link maken…" : "Maak QR / link"}
                      </Button>
                      <div className="text-xs text-slate-500">Link verloopt na ±30 minuten.</div>
                    </div>
                  ) : null}

                  {camError ? (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">{camError}</div>
                  ) : null}

                  {camLink ? (
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                      <div className="rounded-xl border bg-slate-50 p-3">
                        <img src={qrUrl(camLink)} alt="QR code" className="w-full h-auto rounded-lg bg-white" />
                        <div className="text-xs text-slate-500 mt-2">Scan met iPhone/Android camera app of QR scanner.</div>
                      </div>

                      <div className="rounded-xl border p-3">
                        <div className="text-sm font-medium">Koppellink</div>
                        <div className="mt-2 break-all text-xs text-slate-700">{camLink}</div>
                        <div className="mt-3 flex gap-2">
                          <Button onClick={() => copy(camLink)} className="flex-1">
                            Kopieer link
                          </Button>
                          <Button
                            onClick={() => {
                              setCamLink("");
                              setCamError("");
                            }}
                            className="w-28"
                          >
                            Vernieuw
                          </Button>
                        </div>
                        <div className="mt-3 text-xs text-slate-500">Tip: open de link op de telefoon en kies “Sta camera toe”.</div>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 text-xs text-slate-500">
                    Kind ziet nu:{" "}
                    <span className="font-semibold">
                      {activeSource === "screen"
                        ? "Scherm"
                        : (activeSource as string) === "camera"
                          ? "Telefoon"
                          : "Niets"}
                    </span>
                    {(activeSource as string) === "camera" ? (
                      <span className="text-slate-400"> (wacht op “Start camera” op telefoon)</span>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* ====== Snapshot modal ====== */}
      {snapshotModalOpen && activePacketId ? (
        <div className="fixed inset-0 z-[2000] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl max-h-[86vh] rounded-2xl border border-slate-200 bg-white shadow-2xl p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-slate-900 text-sm font-semibold">Aanwijzing</div>
              <button
                className="h-9 w-9 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                onClick={() => setSnapshotModalOpen(false)}
                aria-label="Sluiten"
              >
                ✕
              </button>
            </div>

            <div className="mt-3 overflow-auto max-h-[76vh]">
              <canvas ref={snapshotModalCanvasRef} className="w-full rounded-xl bg-slate-100" />
            </div>
          </div>
        </div>
      ) : null}

      {/* ====== NEW DASHBOARD LOOK ====== */}
      <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col">
        {/* Header */}
        <header className="h-20 border-b border-slate-200 bg-white flex items-center justify-between px-6 lg:px-8 sticky top-0 z-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-white text-xl">👪</span>
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight text-slate-900">Kijk even Mee</h1>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Ouder dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-4 lg:gap-6">
            <div
              className={[
                "flex items-center gap-3 px-4 py-2 rounded-full text-sm font-semibold border",
                chip.bg,
                chip.text,
                chip.border,
              ].join(" ")}
            >
              <span className={["w-2.5 h-2.5 rounded-full", chip.dot, isActive ? "animate-pulse" : ""].join(" ")} />
              {chip.label}
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-bold text-slate-900">Ouder</p>
                <p className="text-xs text-slate-500">Gebruiker</p>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar */}
          <aside className="w-full lg:w-80 border-b lg:border-b-0 lg:border-r border-slate-200 bg-white overflow-y-auto">
            <div className="p-6 lg:p-8 space-y-10">
              {/* Actions */}
              <section>
                <div className="grid grid-cols-1 gap-4">
                  <button
                    onClick={() => void startShare()}
                    disabled={status === "sharing" || status === "connected"}
                    className={[
                      "flex items-center gap-4 p-4 rounded-2xl shadow-md transition-all group",
                      status === "sharing" || status === "connected"
                        ? "bg-indigo-300 text-white cursor-not-allowed"
                        : "bg-indigo-600 hover:bg-indigo-700 text-white",
                    ].join(" ")}
                  >
                    <span className="text-2xl group-hover:scale-110 transition-transform">▶️</span>
                    <span className="font-bold">Delen</span>
                  </button>

                  <button
                    onClick={() => void stopShare()}
                    disabled={status === "idle"}
                    className={[
                      "flex items-center gap-4 p-4 rounded-2xl transition-all group",
                      status === "idle"
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-700",
                    ].join(" ")}
                  >
                    <span className="text-2xl group-hover:scale-110 transition-transform">⏹️</span>
                    <span className="font-bold">Stop Delen</span>
                  </button>
                </div>

                <button
                  onClick={async () => {
                    const liveNow = phoneIsLiveNow();

                    if (!liveNow) {
                      setCamLive(false);
                      setCamPreviewJpeg("");
                      setCamPreviewAt(0);
                      setCamError("");
                      setCamLink("");
                      setCamLoading(false);
                    } else {
                      setCamError("");
                    }

                    setCamOpen(true);

                    if (liveNow) {
                      await broadcastActiveSource("camera");
                    } else {
                      await broadcastActiveSource("screen");
                    }
                  }}
                  className="w-full mt-6 flex items-center justify-center gap-2 p-4 border-2 border-dashed border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600 transition-all rounded-2xl text-sm font-semibold"
                >
                  <span className="text-lg">📷</span>
                  Extra Camera Koppelen
                </button>
              </section>

              {/* Connection status */}
              <section>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-5">Verbinding status</h3>

                <div className="p-5 bg-indigo-50/50 rounded-2xl border border-indigo-100">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm text-slate-600">Status</span>
                    <span className="text-sm font-bold text-indigo-700">
                      {isActive ? "Actief" : status === "error" ? "Probleem" : "Inactief"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Kwaliteit</span>
                    <span className="text-sm font-bold text-indigo-700">
                      {debugLine ? "Uitstekend" : qualityLabel(quality).replace(" Kwaliteit", "")}
                    </span>
                  </div>

                  {debugLine ? (
                    <div className="mt-3 text-xs text-slate-500">
                      Live: <span className="font-semibold text-slate-700">{debugLine}</span>
                    </div>
                  ) : null}
                </div>
              </section>

              {/* Quality */}
              <section>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-5">Beeldkwaliteit</h3>

                <div className="space-y-3">
                  {(["low", "medium", "high"] as Quality[]).map((q) => {
                    const selected = quality === q;
                    const disabled = auto;

                    return (
                      <label
                        key={q}
                        className={[
                          "relative flex items-center p-4 cursor-pointer rounded-2xl transition-colors",
                          selected ? "border-2 border-indigo-500 bg-indigo-50/30" : "border border-slate-200 hover:bg-slate-50",
                          disabled ? "opacity-60 cursor-not-allowed" : "",
                        ].join(" ")}
                      >
                        <input
                          className="w-5 h-5 text-indigo-600 focus:ring-indigo-500 border-slate-300"
                          name="quality"
                          type="radio"
                          checked={selected}
                          disabled={disabled}
                          onChange={async () => {
                            setQuality(q);
                            const pc = pcRef.current;
                            if (pc) await applySenderQuality(pc, q);
                          }}
                        />
                        <div className="ml-4">
                          <span className={["block text-sm font-bold", selected ? "text-indigo-900" : "text-slate-800"].join(" ")}>
                            {qualityLabel(q)}
                          </span>
                          <span className={["block text-xs", selected ? "text-indigo-600" : "text-slate-500"].join(" ")}>
                            {qualitySubtitle(q)}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>

                <div className="mt-8 space-y-4">
                  <label className="flex items-center gap-4 cursor-pointer">
                    <input
                      checked={auto}
                      className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      type="checkbox"
                      onChange={(e) => setAuto(e.target.checked)}
                    />
                    <span className="text-sm font-medium text-slate-600">Automatische kwaliteit</span>
                  </label>
                </div>
              </section>
            </div>
          </aside>

          {/* Main */}
          <main className="flex-1 p-6 lg:p-10 flex flex-col items-center justify-center text-center overflow-y-auto">
            <div className="max-w-2xl w-full">
              <div className="bg-white p-8 lg:p-12 rounded-[2.5rem] shadow-xl shadow-indigo-100/50 border border-indigo-50 flex flex-col items-center">
                <div
                  className={[
                    "w-24 h-24 rounded-full flex items-center justify-center mb-8",
                    isActive ? "bg-emerald-100 text-emerald-600" : status === "error" ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-500",
                  ].join(" ")}
                >
                  <span className="text-5xl">
                    {isActive ? "✅" : status === "error" ? "⚠️" : "🕒"}
                  </span>
                </div>

                <h2 className="text-2xl lg:text-3xl font-extrabold text-slate-900 mb-4">
                  {isActive ? "Je scherm wordt nu gedeeld met je kind" : status === "error" ? "Er ging iets mis" : "Nog niet aan het delen"}
                </h2>

                <p className="text-base lg:text-lg text-slate-600 leading-relaxed mb-8">
                  {isActive
                    ? "Geen zorgen, je kind kijkt op een veilige manier mee om je te helpen. Alles wat je op je scherm doet is nu zichtbaar voor hen."
                    : status === "error"
                      ? "Probeer opnieuw te starten met delen. Als dit blijft gebeuren: ververs de pagina en probeer opnieuw."
                      : "Klik links op “Delen” om te starten. Je ziet geen preview om mirror-effect te voorkomen."}
                </p>

                <div className="flex items-center gap-3 px-6 py-3 bg-slate-50 rounded-2xl border border-slate-100">
                  <span className="text-slate-400">🔒</span>
                  <span className="text-sm font-medium text-slate-500">Veilige verbinding actief</span>
                </div>

                <div className="mt-4 text-xs text-slate-500">
                  Kind ziet nu:{" "}
                  <span className="font-semibold text-slate-700">
                    {activeSource === "screen" ? "Scherm" : activeSource === "camera" ? "Telefoon" : "Niets"}
                  </span>
                </div>
              </div>

              <div className="mt-10 lg:mt-12 flex flex-col items-center">
                <div className="mb-4">
                  <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-white shadow-lg">
                    <span className="text-2xl">🔄</span>
                  </div>
                </div>
                <p className="text-slate-500 font-medium text-lg">
                  {isActive ? (
                    <>
                      Je bent verbonden met <strong>je kind</strong>
                    </>
                  ) : (
                    <>
                      Verbinding nog niet gestart
                    </>
                  )}
                </p>
              </div>
            </div>
          </main>

          {/* Right Sidebar */}
          <aside className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-slate-200 bg-white overflow-y-auto">
            <div className="p-6 lg:p-8 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-lg text-slate-900">Activiteit Kind</h2>
            </div>

            <div className="p-6 lg:p-8 space-y-8">
              {/* Most recent */}
              <section>
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Meest recente aanwijzing</h3>

                  <button
                    className="p-2 bg-slate-50 hover:bg-indigo-50 text-indigo-600 rounded-xl transition-colors"
                    onClick={() => {
                      // UI-only knop (geen functionaliteit), zoals in je screenshot.
                      // We laten hem staan zonder side-effects.
                    }}
                    type="button"
                    aria-label="Nieuwe aanwijzing"
                  >
                    📸
                  </button>
                </div>

                <button
                  type="button"
                  className="w-full text-left relative group cursor-pointer overflow-hidden rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all"
                  onClick={() => {
                    if (!mostRecent) return;
                    setActivePacketId(mostRecent.id);
                    setSnapshotModalOpen(true);
                  }}
                  disabled={!mostRecent}
                >
                  <div className="aspect-video bg-slate-100 flex items-center justify-center">
                    {mostRecent?.snapshotJpeg ? (
                      <img src={mostRecent.snapshotJpeg} alt="Laatste aanwijzing" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-4xl text-slate-300">🖼️</span>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent flex items-end p-4">
                      <span className="text-white text-sm font-semibold">{mostRecent ? "Net geüpload" : "Nog geen uploads"}</span>
                    </div>
                  </div>
                </button>
              </section>

              {/* Earlier */}
              <section>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-5">Eerdere aanwijzingen</h3>

                <div className="grid grid-cols-2 gap-4">
                  {earlier.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="aspect-square bg-slate-50 border border-slate-200 rounded-xl overflow-hidden flex items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors"
                      onClick={() => {
                        setActivePacketId(p.id);
                        setSnapshotModalOpen(true);
                      }}
                    >
                      {p.snapshotJpeg ? (
                        <img src={p.snapshotJpeg} alt="Aanwijzing" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-slate-300">🖼️</span>
                      )}
                    </button>
                  ))}

                  {/* Fill placeholders up to 4 tiles for the grid look */}
                  {Array.from({ length: Math.max(0, 4 - earlier.length) }).map((_, i) => (
                    <div
                      key={`ph-${i}`}
                      className="aspect-square bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center text-slate-300"
                    >
                      🖼️
                    </div>
                  ))}
                </div>

                {/* subtle unseen indicator */}
                {packets.some((p) => !p.seen) ? (
                  <div className="mt-4 text-xs text-indigo-600 font-semibold">
                    Nieuwe aanwijzing ontvangen
                  </div>
                ) : null}
              </section>
            </div>
          </aside>
        </div>
      </div>
    </FullscreenShell>
  );
}
