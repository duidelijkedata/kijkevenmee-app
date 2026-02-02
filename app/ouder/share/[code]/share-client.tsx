"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Button } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

type SignalMsg =
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any };

export default function ShareClient({ code }: { code: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [status, setStatus] = useState<"idle" | "sharing" | "connected" | "error">("idle");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);

  useEffect(() => {
    // Signaling channel op basis van code
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
      supabase.removeChannel(ch);
    };
  }, [supabase, code]);

  async function startShare() {
    try {
      // 1) Ouder kiest een scherm/venster/tab
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 10 },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      // 2) WebRTC peer
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      // Alleen video track(s)
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

      // 4) Offer → naar kind
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "offer", sdp: offer } satisfies SignalMsg,
      });

      setStatus("sharing");

      // Als ouder stopt met delen via browser UI
      stream.getVideoTracks()[0].onended = () => stopShare();
    } catch (e) {
      console.error(e);
      setStatus("error");
      alert("Scherm delen is niet gelukt. Probeer opnieuw.");
    }
  }

  function stopShare() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    pcRef.current?.close();
    pcRef.current = null;

    setStatus("idle");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Scherm delen</h1>
        <p className="text-slate-600">
          Je kind kan <b>alleen meekijken</b>. Niet klikken of typen. Je kunt altijd stoppen.
        </p>
        <p className="text-slate-600">
          Code voor je kind: <span className="font-mono font-semibold">{code}</span> (kind gaat naar <span className="font-mono">/kind/verbinden</span>)
        </p>
      </header>

      <Card>
        <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl bg-black" />

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {status === "idle" ? (
            <Button variant="primary" className="w-full" onClick={startShare}>
              Deel mijn scherm
            </Button>
          ) : (
            <Button className="w-full" onClick={stopShare}>
              Stop delen
            </Button>
          )}

          <div className="flex items-center justify-center text-sm text-slate-600">
            Status: <span className="ml-2 font-mono">{status}</span>
          </div>
        </div>
      </Card>
    </main>
  );
}
