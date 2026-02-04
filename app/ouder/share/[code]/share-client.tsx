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
  if (q === "low") return "Laag (stabiel)";
  if (q === "medium") return "Medium (scherper)";
  return "Hoog (meest scherp)";
}

function qualityParams(q: Quality) {
  if (q === "low") return { maxBitrate: 2_500_000, idealFps: 15, maxFps: 20 };
  if (q === "medium") return { maxBitrate: 8_000_000, idealFps: 30, maxFps: 30 };
  return { maxBitrate: 12_000_000, idealFps: 30, maxFps: 60 };
}

export default function ShareClient({ code }: { code: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [status, setStatus] = useState<"idle" | "sharing" | "connected" | "error">("idle");

  const [quality, setQuality] = useState<Quality>("medium");
  const [auto, setAuto] = useState(true);
  const [debugLine, setDebugLine] = useState("");

  const [showPreview, setShowPreview] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const channelRef = useRef<any>(null);
  const lastOfferRef = useRef<any>(null);

  const statsTimerRef = useRef<any>(null);
  const lastBytesSentRef = useRef<number | null>(null);
  const lastStatsAtRef = useRef<number | null>(null);

  const [packets, setPackets] = useState<PacketState[]>([]);
  const [activePacketId, setActivePacketId] = useState<string | null>(null);

  const snapshotWrapRef = useRef<HTMLDivElement | null>(null);
  const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null);

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

  // ✅ belangrijk: overlay pas "live" zodra we echt frames ontvangen
  const [camLive, setCamLive] = useState<boolean>(false);

  // overlay is live als camLive true is (dus telefoon heeft “Start camera” gedrukt)
  const phoneIsLive = camLive;

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
          setCamLive(true); // ✅ pas nu wordt overlay "live"
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

    if (videoRef.current) {
      try {
        (videoRef.current as any).srcObject = null;
      } catch {}
    }

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

      if (videoRef.current) {
        if (showPreview) {
          videoRef.current.srcObject = stream;
          videoRef.current.play?.().catch(() => {});
        } else {
          (videoRef.current as any).srcObject = null;
        }
      }

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

  // ===== Snapshot viewer rendering =====
  useEffect(() => {
    if (!activePacketId) return;
    const p = packets.find((x) => x.id === activePacketId);
    if (!p) return;

    setPackets((prev) => prev.map((x) => (x.id === p.id ? { ...x, seen: true } : x)));

    const canvas = snapshotCanvasRef.current;
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

      for (const s of p.shapes) {
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

    img.src = p.snapshotJpeg;
  }, [activePacketId, packets]);

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

            {/* Live-mode: alleen preview + stop */}
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
                {/* QR/link-mode */}
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

      {/* ====== UI ====== */}
      <div className="h-screen w-screen bg-black">
        <ViewerStage>
          <div className="h-full w-full grid grid-cols-1 lg:grid-cols-[360px_1fr_360px]">
            {/* LEFT */}
            <div className="min-w-0 border-b lg:border-b-0 lg:border-r border-white/10">
              <div className="p-3 flex flex-col gap-3">
                <div className="text-white text-sm font-semibold">Ouder – scherm delen</div>

                <div className="flex gap-2 flex-wrap">
                  <Button variant="primary" onClick={startShare} disabled={status === "sharing" || status === "connected"}>
                    Start delen
                  </Button>
                  <Button onClick={stopShare} disabled={status === "idle"}>
                    Stop
                  </Button>

                  <Button
                    onClick={async () => {
                      // reset zodat je altijd eerst QR ziet
                      setCamLive(false);
                      setCamPreviewJpeg("");
                      setCamPreviewAt(0);

                      setCamOpen(true);
                      setCamError("");
                      setCamLink("");
                      setCamLoading(false);

                      // ✅ FIX: kind blijft PC zien (met QR overlay). Telefoonpagina zet later pas 'camera' zodra hij echt start.
                      await broadcastActiveSource("screen");
                    }}
                  >
                    Telefoon als camera
                  </Button>
                </div>

                <div className="rounded-xl bg-white/10 p-3 text-white text-sm">
                  <div>
                    Status: <span className="font-semibold">{status}</span>
                  </div>
                  {debugLine ? <div className="mt-1 text-xs opacity-80">{debugLine}</div> : null}
                </div>

                <div className="rounded-xl bg-white/10 p-3 text-white text-sm">
                  <div className="font-semibold">Kwaliteit</div>
                  <div className="mt-2 flex gap-2 flex-wrap">
                    {(["low", "medium", "high"] as Quality[]).map((q) => (
                      <Button
                        key={q}
                        variant={quality === q ? "primary" : "secondary"}
                        onClick={async () => {
                          setQuality(q);
                          const pc = pcRef.current;
                          if (pc) await applySenderQuality(pc, q);
                        }}
                      >
                        {qualityLabel(q)}
                      </Button>
                    ))}
                  </div>

                  <label className="mt-3 flex items-center gap-2 text-xs opacity-90 select-none">
                    <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                    Auto (placeholder voor later)
                  </label>

                  <label className="mt-2 flex items-center gap-2 text-xs opacity-90 select-none">
                    <input type="checkbox" checked={showPreview} onChange={(e) => setShowPreview(e.target.checked)} />
                    Preview tonen (kan mirror-effect geven)
                  </label>
                </div>
              </div>
            </div>

            {/* CENTER */}
            <div className="min-w-0 flex items-center justify-center">
              <div className="h-full w-full flex items-center justify-center">
                <video ref={videoRef} className="max-h-full max-w-full" />
              </div>
            </div>

            {/* RIGHT */}
            <div className="min-w-0 border-t lg:border-t-0 lg:border-l border-white/10">
              <div className="p-3 flex flex-col gap-3">
                <div className="text-white text-sm font-semibold">Aantekeningen van kind</div>

                <div className="rounded-xl bg-white/10 p-3 text-white text-sm">
                  <div className="text-xs opacity-80">Laatste snapshots</div>

                  <div className="mt-2 flex flex-col gap-2 max-h-[40vh] overflow-auto pr-1">
                    {packets
                      .slice()
                      .reverse()
                      .map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setActivePacketId(p.id)}
                          className={`text-left rounded-xl border px-3 py-2 ${
                            p.id === activePacketId
                              ? "bg-white text-black"
                              : "bg-transparent text-white/90 border-white/20"
                          }`}
                        >
                          <div className="text-xs opacity-80">
                            {new Date(p.createdAt).toLocaleTimeString()}
                            {!p.seen ? " • nieuw" : ""}
                          </div>
                          <div className="text-sm font-medium">Snapshot</div>
                        </button>
                      ))}
                    {packets.length === 0 ? <div className="text-xs opacity-70">Nog geen snapshots.</div> : null}
                  </div>
                </div>

                <div ref={snapshotWrapRef} className="rounded-xl bg-white/10 p-3">
                  <div className="text-white text-xs opacity-80 mb-2">Snapshot viewer</div>
                  <canvas ref={snapshotCanvasRef} className="w-full rounded-lg bg-black/40" />
                </div>
              </div>
            </div>
          </div>
        </ViewerStage>
      </div>
    </FullscreenShell>
  );
}
