"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Card, Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

type SignalMsg =
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any };

function formatCode(v: string) {
  const digits = v.replace(/\D/g, "").slice(0, 6);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0,3)} ${digits.slice(3)}`;
}

export default function KindVerbinden() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [code, setCode] = useState("");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<"idle"|"connecting"|"connected"|"error">("idle");
  const videoRef = useRef<HTMLVideoElement|null>(null);

  const pcRef = useRef<RTCPeerConnection|null>(null);
  const channelRef = useRef<any>(null);

  async function connect() {
    const raw = code.replace(/\D/g, "");
    if (raw.length !== 6) return alert("Vul 6 cijfers in.");

    setStatus("connecting");
    const ch = supabase.channel(`signal:${raw}`);
    channelRef.current = ch;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (videoRef.current) videoRef.current.srcObject = stream;
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        ch.send({ type: "broadcast", event: "signal", payload: { type: "ice", candidate: e.candidate } satisfies SignalMsg });
      }
    };

    ch.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;
      try {
        if (msg.type === "offer") {
          await pc.setRemoteDescription(msg.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await ch.send({ type: "broadcast", event: "signal", payload: { type: "answer", sdp: answer } satisfies SignalMsg });
          setStatus("connected");
          setConnected(true);
        } else if (msg.type === "ice") {
          await pc.addIceCandidate(msg.candidate);
        }
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    }).subscribe();
  }

  function disconnect() {
    pcRef.current?.close();
    pcRef.current = null;
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    channelRef.current = null;
    setConnected(false);
    setStatus("idle");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Meekijken</h1>
        <p className="text-slate-600">Vul de code in die je ouder ziet.</p>
      </header>

      <Card className="space-y-4">
        <Input
          value={code}
          onChange={(e)=>setCode(formatCode(e.target.value))}
          placeholder="123 456"
          inputMode="numeric"
        />
        {!connected ? (
          <Button variant="primary" className="w-full" onClick={connect}>
            Verbind
          </Button>
        ) : (
          <Button className="w-full" onClick={disconnect}>
            Stop meekijken
          </Button>
        )}
      </Card>

      <Card>
        <div className="text-sm text-slate-600 mb-3">Status: <span className="font-mono">{status}</span></div>
        <div className="rounded-xl bg-black/90">
          <video ref={videoRef} autoPlay playsInline className="w-full rounded-xl" />
        </div>
      </Card>
    </main>
  );
}
