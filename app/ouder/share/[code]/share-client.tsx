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
  // Let op: upload van ouder is de echte bottleneck
  if (q === "low") return { maxBitrate: 900_000, maxFramerate: 12, frameRate: 12 };
  if (q === "medium") return { maxBitrate: 2_000_000, maxFramerate: 15, frameRate: 15 };
  return { maxBitrate: 3_500_000, maxFramerate: 20, frameRate: 20 };
}

export default function ShareClient({ code }: { code: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [status, setStatus] = useState<"idle" | "sharing" | "connected" | "error">("idle");
  const [quality, setQuality] = useState<Quality>("medium");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);

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

    // Belangrijk: maxBitrate (bps) is dé knop voor scherpere tekst
    params.encodings[0].maxBitrate = maxBitrate;
    params.encodings[0].maxFramerate = maxFramerate;

    await videoSender.setParameters(params);
  }

  async function startShare(q: Quality) {
    try {
      // Als er al iets loopt: eerst stoppen
      stopShare();

      const { frameRate } = qualityParams(q);

      // 1) Scherm kiezen
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

      // 2) WebRTC peer
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      // 3) ICE candidates doorsturen
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          channelRef.current?.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "ice", candidate: e.candidate } satisfies SignalMsg,
          });
        }
      };

      // 4) Kwaliteit toepassen (bitrate/framerate)
      await applySenderQuality(pc, q);

      // 5) Offer -> kind
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "offer", sdp: offer } satisfies SignalMsg,
      });

      setStatus("sharing");

      // Als ouder stopt met delen via browser UI
      const vt = stream.getVideoTracks()[0];
      vt.onended = () => stopShare();
    } catch (e) {
      console.error(e);
      setStatus("error");
      alert("Scherm delen is niet gelukt. Probeer opnieuw.");
    }
  }

  function stopShare() {
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
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">Kwaliteit</label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as Quality)}
              className="h-10 rounded-xl border px-3 bg-white"
              disabled={status !== "idle"}
              title={status !== "idle" ? "Stop eerst delen om kwaliteit te wijzigen" : ""}
            >
              <option value="low">{qualityLabel("low")}</option>
              <option value="medium">{qualityLabel("medium")}</option>
              <option value="high">{qualityLabel("high")}</option>
            </select>
          </div>
        </div>

        <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl bg-black" />

        <div className="grid gap-2 sm:grid-cols-2">
          {status === "idle" ? (
            <Button variant="primary" className="w-full" onClick={() => startShare(quality)}>
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

        {quality === "high" ? (
          <p className="text-sm text-slate-600">
            Hoog kan meer data gebruiken. Als het hakkelt: kies Medium.
          </p>
        ) : null}
      </Card>
    </main>
  );
}
