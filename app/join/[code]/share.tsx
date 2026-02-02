"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

type SignalMsg =
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any };

export default function ParentShare({ code }: { code: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [status, setStatus] = useState<"idle"|"sharing"|"connected"|"error">("idle");
  const [caption, setCaption] = useState("");
  const videoRef = useRef<HTMLVideoElement|null>(null);
  const streamRef = useRef<MediaStream|null>(null);
  const pcRef = useRef<RTCPeerConnection|null>(null);

  const channelRef = useRef<any>(null);

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

    return () => { supabase.removeChannel(ch); };
  }, [supabase, code]);

  async function startShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 10 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

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

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "offer", sdp: offer } satisfies SignalMsg,
      });

      setStatus("sharing");

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

  async function snapshotAndSend() {
    const v = videoRef.current;
    if (!v) return;

    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 1280;
    canvas.height = v.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

    const blob: Blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png", 1.0)
    );

    const form = new FormData();
    form.append("code", code);
    form.append("caption", caption);
    form.append("file", blob, "snapshot.png");

    const res = await fetch("/api/snapshots/upload", { method: "POST", body: form });
    const json = await res.json();
    if (json.error) alert(json.error);
    else alert("Schermafbeelding verstuurd ✅");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Scherm delen</h1>
        <p className="text-slate-600">
          Je kind kan alleen meekijken. Niet klikken of typen. Je kunt altijd stoppen.
        </p>
      </header>

      <Card>
        <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl bg-black" />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {status === "idle" ? (
            <Button variant="primary" className="w-full" onClick={startShare}>Deel mijn scherm</Button>
          ) : (
            <Button className="w-full" onClick={stopShare}>Stop delen</Button>
          )}
          <div className="flex items-center justify-center text-sm text-slate-600">
            Status: <span className="ml-2 font-mono">{status}</span>
          </div>
        </div>

        <div className="mt-6 border-t pt-4 space-y-2">
          <h2 className="text-lg font-semibold">Schermafbeelding delen</h2>
          <Input
            value={caption}
            onChange={(e)=>setCaption(e.target.value)}
            placeholder="Korte uitleg (bijv. ‘Dit is de mail die ik kreeg’)"
          />
          <Button className="w-full" onClick={snapshotAndSend} disabled={status === "idle"}>
            Maak momentopname & verstuur
          </Button>
          <p className="text-sm text-slate-600">
            Je kind ziet deze schermafbeelding later in zijn overzicht.
          </p>
        </div>
      </Card>
    </main>
  );
}
