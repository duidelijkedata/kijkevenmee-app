"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Button } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

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

function clampQuality(q: Quality, dir: "down" | "up"): Quality {
  if (dir === "down") {
    if (q === "high") return "medium";
    if (q === "medium") return "low";
    return "low";
  } else {
    if (q === "low") return "medium";
    if (q === "medium") return "high";
    return "high";
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function ShareClient({ code }: { code: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [status, setStatus] = useState<"idle" | "sharing" | "connected" | "error">("idle");

  const [quality, setQuality] = useState<Quality>("medium");
  const [auto, setAuto] = useState(true);
  const [autoQuality, setAutoQuality] = useState<Quality>("medium");
  const [debugLine, setDebugLine] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);

  // Handshake: bewaar laatste offer om opnieuw te kunnen sturen als kind later joint
  const lastOfferRef = useRef<any>(null);

  const statsTimerRef = useRef<any>(null);
  const lastDecisionAtRef = useRef<number>(0);
  const goodStreakRef = useRef<number>(0);
  const badStreakRef = useRef<number>(0);
  const lastBytesSentRef = useRef<number | null>(null);
  const lastStatsAtRef = useRef<number | null>(null);

  // packets van kind (sticky)
  const [packets, setPackets] = useState<PacketState[]>([]);
  const [activePacketId, setActivePacketId] = useState<string | null>(null);

  // UI: lijst inklapbaar
  const [showList, setShowList] = useState(true);

  // Snapshot viewer refs
  const snapshotWrapRef = useRef<HTMLDivElement | null>(null);
  const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const origin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://kijkevenmee-app.vercel.app";

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        setPackets((prev) => prev.map((p) => ({ ...p, seen: true })));
      }
    };
    document.addEventListener("visibilitychange", onVis);
    onVis();
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  async function broadcastQuality(q: Quality) {
    try {
      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "quality", quality: q } satisfies SignalMsg,
      });
    } catch {}
  }

  async function sendOfferAgainIfWeHaveOne() {
    const ch = channelRef.current;
    const offer = lastOfferRef.current;
    if (!ch || !offer) return;
    try {
      await ch.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "offer", sdp: offer } satisfies SignalMsg,
      });
    } catch {}
  }

  useEffect(() => {
    const ch = supabase.channel(`signal:${code}`);
    channelRef.current = ch;

    ch.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;

      try {
        if (msg.type === "hello") {
          // FIX: kind is er nu pas → resend offer (als ouder al gestart was)
          await sendOfferAgainIfWeHaveOne();
          return;
        }

        if (msg.type === "draw_packet") {
          const packet = msg.packet;
          setPackets((prev) => [
            ...prev,
            {
              ...packet,
              seen: document.visibilityState === "visible",
            },
          ]);
          setActivePacketId(packet.id);
          // terwijl je aanwijzing bekijkt wil je meestal meer ruimte → lijst dicht
          setShowList(false);
          return;
        }

        if (!pcRef.current) return;

        if (msg.type === "answer") {
          await pcRef.current.setRemoteDescription(msg.sdp);
          setStatus("connected");
        } else if (msg.type === "ice") {
          await pcRef.current.addIceCandidate(msg.candidate);
        }
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    }).subscribe();

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {}
    };
  }, [supabase, code]);

  async function applySenderQuality(pc: RTCPeerConnection, q: Quality) {
    const { maxBitrate, maxFramerate } = qualityParams(q);

    const videoSender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (!videoSender) return;

    const params = videoSender.getParameters();
    params.encodings = params.encodings || [{}];
    params.encodings[0].maxBitrate = maxBitrate;
    params.encodings[0].maxFramerate = maxFramerate;

    await videoSender.setParameters(params);
    await broadcastQuality(q);
  }

  function stopStatsLoop() {
    if (statsTimerRef.current) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
    lastBytesSentRef.current = null;
    lastStatsAtRef.current = null;
    goodStreakRef.current = 0;
    badStreakRef.current = 0;
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
        let packetsSent: number | null = null;
        let packetsLost: number | null = null;
        let rttMs: number | null = null;

        stats.forEach((r: any) => {
          if (r.type === "outbound-rtp" && r.kind === "video") {
            bytesSent = typeof r.bytesSent === "number" ? r.bytesSent : bytesSent;
            packetsSent = typeof r.packetsSent === "number" ? r.packetsSent : packetsSent;
          }
          if (r.type === "remote-inbound-rtp" && r.kind === "video") {
            packetsLost = typeof r.packetsLost === "number" ? r.packetsLost : packetsLost;
          }
          if (r.type === "candidate-pair" && r.state === "succeeded" && r.currentRoundTripTime != null) {
            rttMs = Math.round(r.currentRoundTripTime * 1000);
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

        let lossPct: number | null = null;
        if (packetsLost != null && packetsSent != null && packetsSent + packetsLost > 0) {
          lossPct = Math.round((packetsLost / (packetsSent + packetsLost)) * 1000) / 10;
        }

        const kbps = bitrateBps != null ? Math.round(bitrateBps / 1000) : null;
        setDebugLine(`auto=${autoQuality} • bitrate=${kbps ?? "?"}kbps • loss=${lossPct ?? "?"}% • rtt=${rttMs ?? "?"}ms`);

        const COOLDOWN_MS = 8000;
        if (now - lastDecisionAtRef.current < COOLDOWN_MS) return;

        const { maxBitrate } = qualityParams(autoQuality);

        const bad =
          (lossPct != null && lossPct >= 3) ||
          (rttMs != null && rttMs >= 450) ||
          (bitrateBps != null && bitrateBps < maxBitrate * 0.55);

        const good =
          (lossPct == null || lossPct <= 1) &&
          (rttMs == null || rttMs <= 250) &&
          (bitrateBps == null || bitrateBps > maxBitrate * 0.8);

        if (bad) {
          badStreakRef.current += 1;
          goodStreakRef.current = 0;
        } else if (good) {
          goodStreakRef.current += 1;
          badStreakRef.current = 0;
        } else {
          badStreakRef.current = Math.max(0, badStreakRef.current - 1);
          goodStreakRef.current = Math.max(0, goodStreakRef.current - 1);
        }

        if (badStreakRef.current >= 2) {
          const next = clampQuality(autoQuality, "down");
          if (next !== autoQuality && pcRef.current) {
            await applySenderQuality(pcRef.current, next);
            setAutoQuality(next);
            lastDecisionAtRef.current = now;
          }
          badStreakRef.current = 0;
          return;
        }

        if (goodStreakRef.current >= 5) {
          const next = clampQuality(autoQuality, "up");
          if (next !== autoQuality && pcRef.current) {
            await applySenderQuality(pcRef.current, next);
            setAutoQuality(next);
            lastDecisionAtRef.current = now;
          }
          goodStreakRef.current = 0;
          return;
        }
      } catch {}
    }, 2000);
  }

  async function startShare() {
    try {
      stopShare();
      setAutoQuality(quality);

      const { frameRate } = qualityParams(quality);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate, width: { ideal: 1920 }, height: { ideal: 1080 } } as any,
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play?.().catch(() => {});
      }

      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      pcRef.current = pc;

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          channelRef.current?.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "ice", candidate: e.candidate } satisfies SignalMsg,
          });
        }
      };

      await applySenderQuality(pc, quality);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // bewaar om opnieuw te kunnen sturen als kind later pas joint
      lastOfferRef.current = offer;

      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "offer", sdp: offer } satisfies SignalMsg,
      });

      setStatus("sharing");
      startStatsLoop();

      stream.getVideoTracks()[0].onended = () => stopShare();
    } catch (e) {
      console.error(e);
      setStatus("error");
      alert("Scherm delen is niet gelukt. Probeer opnieuw.");
    }
  }

  function stopShare() {
    stopStatsLoop();
    lastOfferRef.current = null;

    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;

    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;

    setStatus("idle");
  }

  // snapshot overlay renderer
  useEffect(() => {
    let raf = 0;

    function resizeCanvas() {
      const c = snapshotCanvasRef.current;
      const wrap = snapshotWrapRef.current;
      if (!c || !wrap) return;
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
      const c = snapshotCanvasRef.current;
      const wrap = snapshotWrapRef.current;
      if (!c || !wrap) {
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

  const unseenCount = packets.filter((p) => !p.seen).length;
  const active = packets.find((p) => p.id === activePacketId) ?? null;

  function clearAll() {
    setPackets([]);
    setActivePacketId(null);
  }

  const shareUrl = `${origin}/ouder/share/${encodeURIComponent(code)}`;
  const kidUrl = `${origin}/kind/verbinden`;

  return (
    <main className="mx-auto max-w-6xl px-3 pb-6">
      {/* Compact header */}
      <div className="pt-4 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Scherm delen</h1>
            <p className="text-slate-600 text-sm">
              Code: <span className="font-mono font-semibold">{code}</span>
              {unseenCount > 0 ? (
                <>
                  {" "}
                  • <span className="font-semibold text-slate-900">{unseenCount} nieuw</span>
                </>
              ) : null}
            </p>
            <p className="text-slate-600 text-xs">
              Kind opent: <span className="font-mono">{kidUrl}</span> • Deze pagina: <span className="font-mono">{shareUrl}</span>
            </p>
          </div>

          {/* Tiny controls */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as Quality)}
              className="h-10 rounded-xl border px-3 bg-white"
              disabled={status !== "idle"}
              title={status !== "idle" ? "Stop eerst delen om startkwaliteit te wijzigen" : ""}
            >
              <option value="low">{qualityLabel("low")}</option>
              <option value="medium">{qualityLabel("medium")}</option>
              <option value="high">{qualityLabel("high")}</option>
            </select>

            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} disabled={status === "idle"} />
              Auto
            </label>

            <Button onClick={() => setShowList((s) => !s)}>{showList ? "Verberg lijst" : "Toon lijst"}</Button>

            {status === "idle" ? (
              <Button variant="primary" onClick={startShare}>
                Deel scherm
              </Button>
            ) : (
              <Button onClick={stopShare}>Stop</Button>
            )}
          </div>
        </div>

        {status !== "idle" ? <div className="mt-2 text-xs text-slate-500 font-mono">{debugLine || "stats…"}</div> : null}
      </div>

      {/* Main area: viewer maximal */}
      <div className={`grid gap-4 ${showList ? "lg:grid-cols-[1.6fr_1fr]" : "lg:grid-cols-1"}`}>
        {/* Viewer */}
        <Card className="p-3">
          <div
            className="rounded-2xl overflow-hidden bg-black"
            style={{
              height: "calc(100vh - 220px)",
              minHeight: 420,
              position: "relative",
            }}
          >
            {active ? (
              <div ref={snapshotWrapRef} className="w-full h-full" style={{ position: "relative" }}>
                <img src={active.snapshotJpeg} alt="Snapshot" className="w-full h-full object-contain block" />
                <canvas ref={snapshotCanvasRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />

                {/* Compact overlay controls in viewer */}
                <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                  <Button onClick={() => setActivePacketId(null)}>Terug naar live</Button>
                  <Button onClick={clearAll}>Wis alles</Button>
                </div>
              </div>
            ) : (
              <div className="w-full h-full">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
              </div>
            )}
          </div>
        </Card>

        {/* Sidebar list (toggleable) */}
        {showList ? (
          <Card className="p-3">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-semibold">Aanwijzingen</h2>
              {packets.length > 0 ? <Button onClick={clearAll}>Wis alles</Button> : null}
            </div>

            {packets.length === 0 ? (
              <p className="text-sm text-slate-600">
                Nog geen aanwijzingen. Het kind tekent en klikt op <b>Delen</b>.
              </p>
            ) : (
              <div className="space-y-3" style={{ maxHeight: "calc(100vh - 320px)", overflow: "auto" }}>
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
                      className={`w-full text-left rounded-xl border p-3 transition ${
                        activePacketId === p.id ? "border-slate-900" : "border-slate-200 hover:border-slate-400"
                      }`}
                    >
                      <div className="flex gap-3">
                        <img src={p.snapshotJpeg} alt="Snapshot" className="h-20 w-32 object-cover rounded-lg border" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold truncate">Aanwijzing</div>
                            {!p.seen ? (
                              <span className="text-xs rounded-full bg-blue-100 text-blue-900 px-2 py-0.5">nieuw</span>
                            ) : null}
                          </div>
                          <div className="text-xs text-slate-600 mt-1">{new Date(p.createdAt).toLocaleString()}</div>
                          <div className="text-xs text-slate-600 mt-1">Markeringen: {p.shapes.length}</div>
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </main>
  );
}
