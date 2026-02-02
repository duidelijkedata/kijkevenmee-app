"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Button } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Quality = "low" | "medium" | "high";

type DraftShape =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number };

type DrawPacket = {
  id: string;
  createdAt: number;
  snapshotJpeg: string;
  shapes: DraftShape[];
};

type SignalMsg =
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any }
  | { type: "quality"; quality: Quality }
  | { type: "draw_packet"; packet: DrawPacket };

type PacketState = DrawPacket & {
  seen: boolean;
};

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

export default function ShareClient({ code }: { code: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [status, setStatus] = useState<"idle" | "sharing" | "connected" | "error">("idle");

  const [quality, setQuality] = useState<Quality>("medium");
  const [auto, setAuto] = useState(true);
  const [autoQuality, setAutoQuality] = useState<Quality>("medium");
  const [debugLine, setDebugLine] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoWrapRef = useRef<HTMLDivElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);

  const statsTimerRef = useRef<any>(null);
  const lastDecisionAtRef = useRef<number>(0);
  const goodStreakRef = useRef<number>(0);
  const badStreakRef = useRef<number>(0);
  const lastBytesSentRef = useRef<number | null>(null);
  const lastStatsAtRef = useRef<number | null>(null);

  // packets van kind (sticky)
  const [packets, setPackets] = useState<PacketState[]>([]);
  const [activePacketId, setActivePacketId] = useState<string | null>(null);

  // markeer gezien als ouder terugkomt naar tab
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        setPackets((prev) => prev.map((p) => ({ ...p, seen: true })));
      }
    };
    document.addEventListener("visibilitychange", onVis);
    // init: als je al zichtbaar bent
    onVis();
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://kijkevenmee-app.vercel.app";

  async function broadcastQuality(q: Quality) {
    try {
      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "quality", quality: q } satisfies SignalMsg,
      });
    } catch {}
  }

  useEffect(() => {
    const ch = supabase.channel(`signal:${code}`);
    channelRef.current = ch;

    ch.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;

      try {
        if (msg.type === "draw_packet") {
          const packet = msg.packet;

          setPackets((prev) => {
            const next: PacketState[] = [
              ...prev,
              {
                ...packet,
                seen: document.visibilityState === "visible",
              },
            ];
            return next;
          });

          // nieuwste packet actief zetten
          setActivePacketId(packet.id);
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

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
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

      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "offer", sdp: offer } satisfies SignalMsg,
      });

      setStatus("sharing");
      startStatsLoop();

      const vt = stream.getVideoTracks()[0];
      vt.onended = () => stopShare();
    } catch (e) {
      console.error(e);
      setStatus("error");
      alert("Scherm delen is niet gelukt. Probeer opnieuw.");
    }
  }

  function stopShare() {
    stopStatsLoop();

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

  // --- Overlay render: teken shapes van actieve packet bovenop video preview ---
  useEffect(() => {
    let raf = 0;

    function resizeCanvas() {
      const c = overlayCanvasRef.current;
      const wrap = videoWrapRef.current;
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

    function draw() {
      const c = overlayCanvasRef.current;
      const wrap = videoWrapRef.current;
      if (!c || !wrap) {
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

      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const active = packets.find((p) => p.id === activePacketId) ?? null;
      if (!active) {
        raf = requestAnimationFrame(draw);
        return;
      }

      ctx.lineWidth = 6;
      ctx.strokeStyle = "#60a5fa";
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 8;

      for (const s of active.shapes) {
        const x = s.x * w;
        const y = s.y * h;

        if (s.kind === "circle") {
          const r = s.r * Math.max(w, h);
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeRect(s.x * w, s.y * h, s.w * w, s.h * h);
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
  }, [packets, activePacketId]);

  const unseenCount = packets.filter((p) => !p.seen).length;

  function clearActive() {
    if (!activePacketId) return;
    setPackets((prev) => prev.filter((p) => p.id !== activePacketId));
    setActivePacketId((prev) => {
      const remaining = packets.filter((p) => p.id !== prev);
      return remaining.length ? remaining[remaining.length - 1].id : null;
    });
  }

  function clearAll() {
    setPackets([]);
    setActivePacketId(null);
  }

  const shareUrl = `${origin}/ouder/share/${encodeURIComponent(code)}`;
  const kidUrl = `${origin}/kind/verbinden`;

  return (
    <main className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Scherm delen</h1>
        <p className="text-slate-600">
          Je kind kan <b>alleen meekijken</b>. Niet klikken of typen. Je kunt altijd stoppen.
        </p>

        <div className="text-slate-600 text-sm">
          Code voor je kind: <span className="font-mono font-semibold">{code}</span>
          <div className="mt-1">
            Kind opent: <span className="font-mono">{kidUrl}</span>
          </div>
          <div className="mt-1">
            Deze pagina: <span className="font-mono">{shareUrl}</span>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* LEFT: video + overlay */}
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-600">
              Status: <span className="font-mono">{status}</span>
              {auto && status !== "idle" ? (
                <>
                  {" "}
                  • Auto kwaliteit: <span className="font-mono">{autoQuality}</span>
                </>
              ) : null}
              {unseenCount > 0 ? (
                <>
                  {" "}
                  • <span className="font-semibold text-slate-900">{unseenCount} nieuw</span>
                </>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-slate-600">Startkwaliteit</label>
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

              <label className="ml-2 flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={(e) => setAuto(e.target.checked)}
                  disabled={status === "idle"}
                  title={status === "idle" ? "Start eerst delen" : ""}
                />
                Auto-detect
              </label>
            </div>
          </div>

          <div ref={videoWrapRef} className="w-full rounded-xl overflow-hidden bg-black" style={{ position: "relative" }}>
            <video ref={videoRef} autoPlay playsInline muted className="w-full" />
            <canvas
              ref={overlayCanvasRef}
              style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {status === "idle" ? (
              <Button variant="primary" className="w-full" onClick={startShare}>
                Deel mijn scherm ({qualityLabel(quality)})
              </Button>
            ) : (
              <Button className="w-full" onClick={stopShare}>
                Stop delen
              </Button>
            )}

            <div className="flex items-center justify-center text-sm text-slate-600">
              Tip: kies “Hele scherm” voor beste kwaliteit.
            </div>
          </div>

          {status !== "idle" ? (
            <div className="text-xs text-slate-500 font-mono">{debugLine || "stats…"}</div>
          ) : null}

          {activePacketId ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={clearActive}>Wis deze aanwijzing</Button>
              <Button onClick={clearAll}>Wis alles</Button>
            </div>
          ) : null}
        </Card>

        {/* RIGHT: sticky list + thumbnails */}
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Aanwijzingen</h2>
            {packets.length > 0 ? (
              <Button onClick={clearAll}>Wis alles</Button>
            ) : null}
          </div>

          {packets.length === 0 ? (
            <p className="text-sm text-slate-600">
              Nog geen aanwijzingen ontvangen. Als je kind tekent en op “Delen” klikt, verschijnt hier een kaart met screenshot.
            </p>
          ) : (
            <div className="space-y-3">
              {packets
                .slice()
                .reverse()
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setActivePacketId(p.id);
                      // markeer deze als seen
                      setPackets((prev) => prev.map((x) => (x.id === p.id ? { ...x, seen: true } : x)));
                    }}
                    className={`w-full text-left rounded-xl border p-3 transition ${
                      activePacketId === p.id ? "border-slate-900" : "border-slate-200 hover:border-slate-400"
                    }`}
                  >
                    <div className="flex gap-3">
                      <img
                        src={p.snapshotJpeg}
                        alt="Snapshot"
                        className="h-20 w-32 object-cover rounded-lg border"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold truncate">
                            Aanwijzing
                          </div>
                          {!p.seen ? (
                            <span className="text-xs rounded-full bg-blue-100 text-blue-900 px-2 py-0.5">
                              nieuw
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-slate-600 mt-1">
                          {new Date(p.createdAt).toLocaleString()}
                        </div>
                        <div className="text-xs text-slate-600 mt-1">
                          Markeringen: {p.shapes.length}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
