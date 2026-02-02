"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

import FullscreenShell from "@/components/meekijk/FullscreenShell";
import ViewerStage from "@/components/meekijk/ViewerStage";

type Quality = "low" | "medium" | "high";

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
  | { type: "draw_packet"; packet: DrawPacket };

type PacketState = DrawPacket & { seen: boolean };

function qualityLabel(q: Quality) {
  if (q === "low") return "Laag (stabiel)";
  if (q === "medium") return "Medium";
  return "Hoog (scherp)";
}

function qualityParams(q: Quality) {
  if (q === "low") return { maxBitrate: 900_000, maxFramerate: 12, frameRate: 12 };
  if (q === "medium") return { maxBitrate: 2_000_000, maxFramerate: 15, frameRate: 15 };
  return { maxBitrate: 3_500_000, maxFramerate: 20, frameRate: 20 };
}

export default function ShareClient({ code }: { code: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [status, setStatus] = useState<"idle" | "sharing" | "connected" | "error">("idle");

  const [quality, setQuality] = useState<Quality>("medium");
  const [auto, setAuto] = useState(true);
  const [debugLine, setDebugLine] = useState("");

  // ✅ default UIT: voorkomt scherm-in-scherm loop
  const [showPreview, setShowPreview] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);

  // ✅ 1 kanaal voor alles (signaling + packets)
  const channelRef = useRef<any>(null);

  // ✅ Als kind later joint: offer opnieuw kunnen sturen
  const lastOfferRef = useRef<any>(null);

  const statsTimerRef = useRef<any>(null);
  const lastBytesSentRef = useRef<number | null>(null);
  const lastStatsAtRef = useRef<number | null>(null);

  // packets van kind
  const [packets, setPackets] = useState<PacketState[]>([]);
  const [activePacketId, setActivePacketId] = useState<string | null>(null);

  // Snapshot viewer refs
  const snapshotWrapRef = useRef<HTMLDivElement | null>(null);
  const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const origin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://kijkevenmee-app.vercel.app";

  // ✅ Maak channel 1x en blijf daarop luisteren (ook wanneer idle)
  useEffect(() => {
    const ch = supabase.channel(`signal:${code}`);
    channelRef.current = ch;

    ch.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;

      try {
        if (msg.type === "hello") {
          // kind is net binnengekomen → resend offer als ouder al aan het delen is
          if (lastOfferRef.current) {
            await ch.send({
              type: "broadcast",
              event: "signal",
              payload: { type: "offer", sdp: lastOfferRef.current } satisfies SignalMsg,
            });
          }
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
    const { maxBitrate, maxFramerate } = qualityParams(q);
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;

    const params = sender.getParameters();
    params.encodings = params.encodings || [{}];
    params.encodings[0].maxBitrate = maxBitrate;
    params.encodings[0].maxFramerate = maxFramerate;

    await sender.setParameters(params);
    await broadcastQuality(q);
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
        if (!pc || !auto) return;

        const stats = await pc.getStats();
        let bytesSent: number | null = null;

        stats.forEach((r: any) => {
          if (r.type === "outbound-rtp" && r.kind === "video") {
            if (typeof r.bytesSent === "number") bytesSent = r.bytesSent;
          }
        });

        const now = Date.now();
        let bitrateBps: number | null = null;

        if (bytesSent != null && lastBytesSentRef.current != null && lastStatsAtRef.current != null) {
          const dt = (now - lastStatsAtRef.current) / 1000;
          if (dt > 0) {
            const dBytes = bytesSent - lastBytesSentRef.current;
            bitrateBps = Math.max(0, Math.round((dBytes * 8) / dt));
          }
        }

        if (bytesSent != null) lastBytesSentRef.current = bytesSent;
        lastStatsAtRef.current = now;

        const kbps = bitrateBps != null ? Math.round(bitrateBps / 1000) : null;
        setDebugLine(`bitrate=${kbps ?? "?"}kbps`);
      } catch {}
    }, 1500);
  }

  async function stopShare() {
    stopStatsLoop();

    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;

    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;

    if (videoRef.current) {
      try {
        (videoRef.current as any).srcObject = null;
      } catch {}
    }

    lastOfferRef.current = null;
    setStatus("idle");
  }

  async function startShare() {
    await stopShare();
    setStatus("sharing");

    // create pc
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
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { frameRate: qualityParams(quality).frameRate },
        audio: false,
      });

      const track = stream.getVideoTracks()[0];
      track.addEventListener("ended", () => stopShare());

      streamRef.current = stream;

      pc.addTrack(track, stream);

      // ✅ BELANGRIJK: alleen preview tonen als user dat expliciet aanzet,
      // anders krijg je scherm-in-scherm als je "Hele scherm" deelt.
      if (videoRef.current) {
        if (showPreview) {
          videoRef.current.srcObject = stream;
          videoRef.current.play?.().catch(() => {});
        } else {
          (videoRef.current as any).srcObject = null;
        }
      }

      // offer
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
    } catch (e) {
      console.error(e);
      setStatus("error");
      await stopShare();
      alert("Scherm delen geweigerd of mislukt.");
    }
  }

  // Snapshot overlay drawing loop (kind shapes)
  useEffect(() => {
    let raf = 0;

    function resizeCanvas() {
      const wrap = snapshotWrapRef.current;
      const c = snapshotCanvasRef.current;
      if (!wrap || !c) return;

      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
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
      const head = 22;
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
      const wrap = snapshotWrapRef.current;
      const c = snapshotCanvasRef.current;
      if (!wrap || !c) {
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

      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const active = packets.find((p) => p.id === activePacketId) ?? null;
      if (!active) {
        raf = requestAnimationFrame(loop);
        return;
      }

      ctx.lineWidth = 6;
      ctx.strokeStyle = "#60a5fa";
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 8;

      for (const s of active.shapes) {
        if (s.kind === "circle") {
          const x = s.x * w;
          const y = s.y * h;
          const r = s.r * Math.max(w, h);
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.stroke();
        } else if (s.kind === "rect") {
          ctx.strokeRect(s.x * w, s.y * h, s.w * w, s.h * h);
        } else {
          drawArrow(ctx, s.x1 * w, s.y1 * h, s.x2 * w, s.y2 * h);
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
  }, [packets, activePacketId]);

  useEffect(() => {
    return () => {
      stopShare();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unseenCount = packets.filter((p) => !p.seen).length;
  const active = packets.find((p) => p.id === activePacketId) ?? null;

  function clearAll() {
    setPackets([]);
    setActivePacketId(null);
  }

  const shareUrl = `${origin}/ouder/share/${encodeURIComponent(code)}`;
  const kidUrl = `${origin}/kind/verbinden`;

  return (
    <FullscreenShell
      sidebarTitle="Ouder"
      sidebar={
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <div className="text-sm text-white/60">Code</div>
            <div className="text-lg font-mono text-white">{code}</div>

            <div className="mt-2 text-xs text-white/60">
              Kind opent: <span className="font-mono text-white/80">{kidUrl}</span>
            </div>
            <div className="text-xs text-white/60">
              Deze pagina: <span className="font-mono text-white/80">{shareUrl}</span>
            </div>

            {unseenCount > 0 ? (
              <div className="mt-2 text-xs">
                <span className="rounded-full bg-blue-500/20 text-blue-200 px-2 py-0.5">{unseenCount} nieuw</span>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <div className="text-sm text-white/60 mb-2">Delen</div>

            <div className="flex flex-col gap-2">
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as Quality)}
                className="h-10 rounded-xl border px-3 bg-white text-slate-900"
                disabled={status !== "idle"}
                title={status !== "idle" ? "Stop eerst delen om startkwaliteit te wijzigen" : ""}
              >
                <option value="low">{qualityLabel("low")}</option>
                <option value="medium">{qualityLabel("medium")}</option>
                <option value="high">{qualityLabel("high")}</option>
              </select>

              <label className="flex items-center gap-2 text-sm text-white/80">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} disabled={status === "idle"} />
                Auto kwaliteit
              </label>

              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={showPreview}
                  onChange={(e) => setShowPreview(e.target.checked)}
                  disabled={status === "idle"}
                />
                Toon preview (kan “scherm-in-scherm” geven)
              </label>

              {status === "idle" ? (
                <Button variant="primary" onClick={startShare}>
                  Deel scherm
                </Button>
              ) : (
                <Button onClick={stopShare}>Stop</Button>
              )}

              {status !== "idle" ? <div className="text-xs text-white/60 font-mono">{debugLine || "stats…"}</div> : null}
            </div>
          </div>

          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-sm text-white/60">Aanwijzingen</div>
              {packets.length > 0 ? <Button onClick={clearAll}>Wis</Button> : null}
            </div>

            {packets.length === 0 ? (
              <p className="text-sm text-white/70">
                Nog geen aanwijzingen. Het kind tekent en klikt op <b>Delen</b>.
              </p>
            ) : (
              <div className="space-y-2" style={{ maxHeight: "55vh", overflow: "auto" }}>
                {packets
                  .slice()
                  .reverse()
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setActivePacketId(p.id);
                        setPackets((prev) => prev.map((x) => (x.id === p.id ? { ...x, seen: true } : x)));
                      }}
                      className={`w-full text-left rounded-xl border p-2 transition ${
                        activePacketId === p.id ? "border-white/60" : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      <div className="flex gap-2">
                        <img src={p.snapshotJpeg} alt="Snapshot" className="h-14 w-24 object-cover rounded-lg border border-white/10" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-white truncate">Aanwijzing</div>
                            {!p.seen ? (
                              <span className="text-xs rounded-full bg-blue-500/20 text-blue-200 px-2 py-0.5">nieuw</span>
                            ) : null}
                          </div>
                          <div className="text-xs text-white/60 mt-0.5">{new Date(p.createdAt).toLocaleString()}</div>
                          <div className="text-xs text-white/60 mt-0.5">Markeringen: {p.shapes.length}</div>
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      }
    >
      <ViewerStage>
        <div className="absolute inset-0">
          {active ? (
            <div ref={snapshotWrapRef} className="absolute inset-0" style={{ position: "relative" }}>
              <img src={active.snapshotJpeg} alt="Snapshot" className="w-full h-full object-contain block" />
              <canvas ref={snapshotCanvasRef} className="absolute inset-0" style={{ pointerEvents: "none" }} />

              <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                <Button onClick={() => setActivePacketId(null)}>Terug naar live</Button>
                <Button onClick={clearAll}>Wis alles</Button>
              </div>
            </div>
          ) : showPreview ? (
            <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-white/70">
              <div className="max-w-[560px] text-center px-6">
                <div className="text-xl font-semibold text-white mb-2">Scherm delen is actief</div>
                <div className="text-white/70">
                  Om “scherm-in-scherm” te voorkomen tonen we hier standaard geen live preview.
                  <br />
                  Het kind ziet je scherm wél.
                </div>
                <div className="mt-4">
                  <Button onClick={() => setShowPreview(true)}>
                    Preview aan (kan loop geven)
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </ViewerStage>
    </FullscreenShell>
  );
}
