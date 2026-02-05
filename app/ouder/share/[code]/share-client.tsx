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

  // ====== helpers ======
  function stopStatsTimer() {
    if (statsTimerRef.current) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
    lastBytesSentRef.current = null;
    lastStatsAtRef.current = null;
  }

  async function stopShare() {
    stopStatsTimer();

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

      const stream = await navigator.mediaDevices.getDisplayMedia({
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

      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "offer", sdp: offer } satisfies SignalMsg,
        });
      }

      setStatus("connected");
    } catch (e: any) {
      console.error(e);
      setDebugLine(String(e?.message || e));
      setStatus("error");
    }
  }

  // ===== Signaling =====
  useEffect(() => {
    const ch = supabase.channel(`signal:${code}`);
    channelRef.current = ch;

    ch.on("broadcast", { event: "signal" }, async ({ payload }: any) => {
      const msg = payload as SignalMsg;
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "hello") {
        if (lastOfferRef.current && channelRef.current) {
          channelRef.current.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "offer", sdp: lastOfferRef.current } satisfies SignalMsg,
          });
        }
        return;
      }

      if (msg.type === "answer") {
        try {
          await pcRef.current?.setRemoteDescription(msg.sdp);
        } catch (e) {
          console.error(e);
        }
        return;
      }

      if (msg.type === "ice") {
        try {
          await pcRef.current?.addIceCandidate(msg.candidate);
        } catch (e) {
          console.error(e);
        }
        return;
      }

      if (msg.type === "quality") {
        setQuality(msg.quality);
        return;
      }

      if (msg.type === "draw_packet") {
        const pkt = msg.packet;
        setPackets((prev) => {
          if (prev.some((p) => p.id === pkt.id)) return prev;
          return [{ ...pkt, seen: false }, ...prev].slice(0, 50);
        });
        return;
      }

      if (msg.type === "active_source") {
        setActiveSource(msg.source);
        return;
      }

      if (msg.type === "cam_preview") {
        setCamPreviewJpeg(msg.jpeg);
        setCamPreviewAt(msg.at);
        setCamLive(true);
        return;
      }
    });

    ch.subscribe();
    ch.send({ type: "broadcast", event: "signal", payload: { type: "hello", at: Date.now() } satisfies SignalMsg });

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {}
      channelRef.current = null;
    };
  }, [code, supabase]);

  // ====== UI helpers / snapshots ======
  function markSeen(id: string) {
    setPackets((prev) => prev.map((p) => (p.id === id ? { ...p, seen: true } : p)));
  }

  function drawShapes(ctx: CanvasRenderingContext2D, shapes: DraftShape[], w: number, h: number) {
    ctx.save();
    ctx.lineWidth = Math.max(2, Math.round(Math.min(w, h) * 0.006));
    ctx.strokeStyle = "rgba(255,255,0,0.95)";
    ctx.fillStyle = "rgba(255,255,0,0.15)";

    for (const s of shapes) {
      if (s.kind === "circle") {
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r * Math.min(w, h), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (s.kind === "rect") {
        ctx.beginPath();
        ctx.rect(s.x * w, s.y * h, s.w * w, s.h * h);
        ctx.fill();
        ctx.stroke();
      }
      if (s.kind === "arrow") {
        const x1 = s.x1 * w,
          y1 = s.y1 * h,
          x2 = s.x2 * w,
          y2 = s.y2 * h;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const ang = Math.atan2(y2 - y1, x2 - x1);
        const head = Math.max(10, Math.min(w, h) * 0.03);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 8), y2 - head * Math.sin(ang - Math.PI / 8));
        ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 8), y2 - head * Math.sin(ang + Math.PI / 8));
        ctx.closePath();
        ctx.fillStyle = "rgba(255,255,0,0.95)";
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function openPacket(pkt: PacketState) {
    setActivePacketId(pkt.id);
    markSeen(pkt.id);
    setSnapshotModalOpen(true);

    setTimeout(() => {
      const canvas = snapshotModalCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        drawShapes(ctx, pkt.shapes, canvas.width, canvas.height);
      };
      img.src = pkt.snapshotJpeg;
    }, 0);
  }

  // ====== Telefoon QR link ======
  function ensureCamLink() {
    const url = `${origin}/ouder/share/${code}/phone`;
    setCamLink(url);
    return url;
  }

  async function openPhoneOverlay() {
    setCamError("");
    setCamLoading(true);
    try {
      ensureCamLink();
      setCamOpen(true);
    } catch (e: any) {
      setCamError(String(e?.message || e));
    } finally {
      setCamLoading(false);
    }
  }

  const hasUnseen = packets.some((p) => !p.seen);

  return (
    <div className="h-screen w-screen bg-black">
      <ViewerStage>
        <div className="h-full w-full grid grid-cols-1 lg:grid-cols-[360px_1fr_360px]">
          {/* LEFT */}
          <div className="p-3 flex flex-col gap-3">
            <div className="text-white text-sm font-semibold">Scherm delen (ouder)</div>

            <div className="rounded-xl bg-white/10 p-3 text-white text-sm flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs opacity-80">Status</div>
                <div className="text-xs">{status}</div>
              </div>

              <div className="flex gap-2">
                <Button
                  className="h-10 px-3 text-sm"
                  variant="primary"
                  onClick={() => void startShare()}
                  disabled={status === "sharing" || status === "connected"}
                >
                  Start delen
                </Button>
                <Button
                  className="h-10 px-3 text-sm"
                  variant="secondary"
                  onClick={() => void stopShare()}
                  disabled={status === "idle"}
                >
                  Stop
                </Button>
              </div>

              <div className="mt-1 flex flex-col gap-2">
                <div className="text-xs opacity-80">Kwaliteit</div>
                <div className="flex flex-col gap-1">
                  {(["low", "medium", "high"] as Quality[]).map((q) => (
                    <label key={q} className="flex items-center gap-2 text-xs">
                      <input
                        type="radio"
                        name="q"
                        checked={quality === q}
                        onChange={() => setQuality(q)}
                        disabled={auto}
                      />
                      {qualityLabel(q)}
                    </label>
                  ))}
                </div>

                <label className="mt-2 flex items-center gap-2 text-xs opacity-90 select-none">
                  <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                  Automatisch (aanbevolen)
                </label>
              </div>

              {debugLine ? <div className="text-xs text-red-200 break-words">{debugLine}</div> : null}
            </div>

            <div className="rounded-xl bg-white/10 p-3 text-white text-sm flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Telefoon camera</div>
                <div className="text-xs opacity-80">{phoneIsLiveNow() ? "Live" : "Niet live"}</div>
              </div>

              <div className="text-xs opacity-80">
                Gebruik je telefoon als losse camera (bijv. brief/modem/bankpas). Het kind ziet wat jij doorgeeft.
              </div>

              <div className="flex gap-2">
                <Button
                  className="h-10 px-3 text-sm"
                  variant="primary"
                  onClick={() => void openPhoneOverlay()}
                  disabled={camLoading}
                >
                  Koppel telefoon
                </Button>
              </div>

              {camError ? <div className="text-xs text-red-200 break-words">{camError}</div> : null}
            </div>

            <div className="rounded-xl bg-white/10 p-3 text-white text-xs opacity-80">
              Active source: <span className="font-semibold">{activeSource}</span>
            </div>
          </div>

          {/* CENTER */}
          <div className="min-w-0 flex items-center justify-center">
            <div className="h-full w-full flex items-center justify-center">
              {status === "connected" || status === "sharing" ? (
                <div className="rounded-2xl bg-white/10 border border-white/10 px-6 py-5 text-white text-center max-w-[560px]">
                  <div className="text-lg font-semibold">Je scherm wordt nu gedeeld</div>
                  <div className="mt-2 text-sm opacity-80">
                    Je ziet geen preview om mirror-effect te voorkomen. Wil je stoppen? Klik links op{" "}
                    <span className="font-semibold">Stop</span>.
                  </div>
                  {status === "sharing" ? (
                    <div className="mt-2 text-sm opacity-80">Bevestig het delen in je browser-prompt.</div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-2xl bg-white/5 border border-white/10 px-6 py-5 text-white/80 text-center max-w-[560px]">
                  <div className="text-lg font-semibold text-white">Nog niet aan het delen</div>
                  <div className="mt-2 text-sm opacity-80">
                    Klik links op <span className="font-semibold text-white">Start delen</span> om te beginnen.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT */}
          <div className="min-w-0 border-t lg:border-t-0 lg:border-l border-white/10">
            <div className="p-3 flex flex-col gap-3">
              <div className="text-white text-sm font-semibold">Aantekeningen van kind</div>

              <div className="rounded-xl bg-white/10 p-3 text-white text-sm">
                <div className="text-xs opacity-80">Laatst ontvangen</div>
                <div className="mt-2 flex flex-col gap-2">
                  {packets.length === 0 ? (
                    <div className="text-xs opacity-70">Nog geen aantekeningen.</div>
                  ) : (
                    packets.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => openPacket(p)}
                        className="text-left rounded-lg bg-white/5 hover:bg-white/10 transition p-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold">{new Date(p.createdAt).toLocaleString()}</div>
                          {!p.seen ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-400/20 text-yellow-200">
                              Nieuw
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-[11px] opacity-80">Shapes: {p.shapes.length}</div>
                      </button>
                    ))
                  )}
                </div>

                {hasUnseen ? <div className="mt-2 text-[11px] opacity-80">Tip: klik om te openen (ESC sluit).</div> : null}
              </div>

              {/* Snapshot modal */}
              {snapshotModalOpen ? (
                <div
                  className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"
                  onClick={() => setSnapshotModalOpen(false)}
                >
                  <div
                    className="max-w-[96vw] max-h-[92vh] w-[1100px] rounded-2xl bg-black/80 border border-white/10 p-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between pb-2">
                      <div className="text-white text-sm font-semibold">Aantekening</div>
                      <Button
                        className="h-10 px-3 text-sm"
                        variant="secondary"
                        onClick={() => setSnapshotModalOpen(false)}
                      >
                        Sluiten (ESC)
                      </Button>
                    </div>
                    <div className="rounded-xl bg-black/50 border border-white/10 overflow-auto max-h-[80vh] p-2">
                      <canvas ref={snapshotModalCanvasRef} className="block max-w-full h-auto" />
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Cam overlay */}
              {camOpen ? (
                <div
                  className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
                  onClick={() => setCamOpen(false)}
                >
                  <div
                    className="w-full max-w-[680px] rounded-2xl bg-black/80 border border-white/10 p-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-white text-sm font-semibold">Telefoon koppelen</div>
                      <Button
                        className="h-10 px-3 text-sm"
                        variant="secondary"
                        onClick={() => setCamOpen(false)}
                      >
                        Sluiten
                      </Button>
                    </div>

                    <div className="mt-3 text-white text-sm">
                      {phoneIsLiveNow() ? (
                        <div className="text-xs opacity-80">Telefoon is live. Geen QR nodig.</div>
                      ) : (
                        <>
                          <div className="text-xs opacity-80">Open deze link op je telefoon (of scan QR):</div>
                          <div className="mt-2 rounded-xl bg-white/10 p-2 text-xs break-all">
                            {camLink || ensureCamLink()}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="mt-4 rounded-xl bg-white/5 border border-white/10 p-3">
                      <div className="text-white text-xs opacity-80 mb-2">Preview (telefoon)</div>
                      {camPreviewJpeg ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={camPreviewJpeg} alt="Telefoon preview" className="w-full rounded-lg" />
                      ) : (
                        <div className="text-xs opacity-70">Nog geen beeld ontvangen.</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Hidden snapshot canvases */}
              <div ref={snapshotWrapRef} className="hidden">
                <canvas ref={snapshotCanvasRef} />
              </div>

              <div className="hidden">
                <canvas ref={snapshotModalCanvasRef} />
              </div>
            </div>
          </div>
        </div>
      </ViewerStage>
    </div>
  );
}
