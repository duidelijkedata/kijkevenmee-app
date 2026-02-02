"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Button } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

type SignalMsg =
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any };

type Quality = "low" | "medium" | "high";

function qualityLabel(q: Quality) {
  if (q === "low") return "Laag (stabiel)";
  if (q === "medium") return "Medium";
  return "Hoog (scherp)";
}

function qualityParams(q: Quality) {
  // Richtwaarden voor desktop text sharing
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

  // Manual selector bepaalt de startkwaliteit; tijdens delen kan auto-detect hem aanpassen.
  const [quality, setQuality] = useState<Quality>("medium");

  const [auto, setAuto] = useState(true);
  const [autoQuality, setAutoQuality] = useState<Quality>("medium");

  const [debugLine, setDebugLine] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);

  const statsTimerRef = useRef<any>(null);
  const lastDecisionAtRef = useRef<number>(0);
  const goodStreakRef = useRef<number>(0);
  const badStreakRef = useRef<number>(0);
  const lastBytesSentRef = useRef<number | null>(null);
  const lastStatsAtRef = useRef<number | null>(null);

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://kijkevenmee-app.vercel.app";

  useEffect(() => {
    const ch = supabase.channel(`signal:${code}`);
    channelRef.current = ch;

    ch.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;
      try {
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

        // We zoeken outbound video stats
        let bytesSent: number | null = null;
        let packetsSent: number | null = null;
        let packetsLost: number | null = null;

        // RTT (candidate-pair, als beschikbaar)
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

        // bitrate berekenen op basis van bytesSent delta
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

        // loss ratio (ruw): packetsLost / (packetsSent + packetsLost)
        let lossPct: number | null = null;
        if (packetsLost != null && packetsSent != null && packetsSent + packetsLost > 0) {
          lossPct = Math.round((packetsLost / (packetsSent + packetsLost)) * 1000) / 10; // 0.1%
        }

        // Debug regel (handig om te zien wat er gebeurt)
        const kbps = bitrateBps != null ? Math.round(bitrateBps / 1000) : null;
        setDebugLine(
          `auto=${autoQuality} • bitrate=${kbps ?? "?"}kbps • loss=${lossPct ?? "?"}% • rtt=${rttMs ?? "?"}ms`
        );

        // --- Auto decision logic ---
        // cooldown om flappen te voorkomen
        const COOLDOWN_MS = 8000;
        if (now - lastDecisionAtRef.current < COOLDOWN_MS) return;

        const { maxBitrate } = qualityParams(autoQuality);

        // Define "bad" if:
        // - loss >= 3%  OR RTT >= 450ms OR bitrate significantly below target (bijv. < 55% van maxBitrate)
        const bad =
          (lossPct != null && lossPct >= 3) ||
          (rttMs != null && rttMs >= 450) ||
          (bitrateBps != null && bitrateBps < maxBitrate * 0.55);

        // Define "good" if:
        // - loss <= 1% AND RTT <= 250ms AND bitrate close to target (> 80% of target)
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
          // neutraal: streaks langzaam laten teruglopen
          badStreakRef.current = Math.max(0, badStreakRef.current - 1);
          goodStreakRef.current = Math.max(0, goodStreakRef.current - 1);
        }

        // Downshift sneller dan upshift (stabiliteit)
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
      } catch (e) {
        // stats errors niet fataal maken
        // console.debug(e);
      }
    }, 2000);
  }

  async function startShare() {
    try {
      stopShare();

      // Startkwaliteit = manual selector, maar autoQuality start daar ook mee
      setAutoQuality(quality);

      const { frameRate } = qualityParams(quality);

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        } as any,
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

      // Pas startkwaliteit toe (bitrate/framerate)
      await applySenderQuality(pc, quality);

      // Offer -> kind
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

  const shareUrl = `${origin}/ouder/share/${encodeURIComponent(code)}`;
  const kidUrl = `${origin}/kind/verbinden`;

  return (
    <main className="mx-auto max-w-3xl space-y-6">
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

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            Status: <span className="font-mono">{status}</span>
            {auto && status !== "idle" ? (
              <>
                {" "}• Auto kwaliteit: <span className="font-mono">{autoQuality}</span>
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

        <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl bg-black" />

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
          <div className="text-xs text-slate-500 font-mono">
            {debugLine || "stats…"}
          </div>
        ) : null}
      </Card>
    </main>
  );
}
