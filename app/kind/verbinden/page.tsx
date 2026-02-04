"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type ActiveSource = "screen" | "camera";

type SignalMsg =
  | { type: "hello"; at: number }
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any }
  | { type: "active_source"; source: ActiveSource };

export default function KindVerbindenPage() {
  const supabase = supabaseBrowser();

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);       // PC scherm
  const pcCamRef = useRef<RTCPeerConnection | null>(null);    // Telefoon camera

  const screenStreamRef = useRef<MediaStream | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);

  const activeSourceRef = useRef<ActiveSource>("screen");
  const [activeSource, setActiveSource] = useState<ActiveSource>("screen");

  function attachStream(stream: MediaStream) {
    const v = videoRef.current;
    if (!v) return;

    v.srcObject = stream;
    v.muted = true;
    v.playsInline = true;
    // @ts-ignore
    v.disablePictureInPicture = true;

    v.play?.().catch(() => {});
  }

  useEffect(() => {
    const channel = supabase.channel("signal:active");

    channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
      const msg = payload as SignalMsg;

      if (msg.type === "active_source") {
        activeSourceRef.current = msg.source;
        setActiveSource(msg.source);

        if (msg.source === "screen" && screenStreamRef.current) {
          attachStream(screenStreamRef.current);
        }
        if (msg.source === "camera" && camStreamRef.current) {
          attachStream(camStreamRef.current);
        }
      }
    });

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  useEffect(() => {
    // ===== PC SCHERM =====
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      screenStreamRef.current = stream;

      if (activeSourceRef.current === "screen") {
        attachStream(stream);
      }
    };

    // ===== TELEFOON CAMERA =====
    const pcCam = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcCamRef.current = pcCam;

    pcCam.ontrack = (e) => {
      const stream = e.streams[0];
      camStreamRef.current = stream;

      if (activeSourceRef.current === "camera") {
        attachStream(stream);
      }
    };

    return () => {
      pc.close();
      pcCam.close();
    };
  }, []);

  return (
    <main className="h-screen w-screen bg-black flex items-center justify-center">
      <video
        ref={videoRef}
        className="max-h-full max-w-full"
      />

      {/* debug (optioneel, mag weg) */}
      <div className="fixed bottom-3 left-3 text-xs text-white/60">
        Actieve bron: {activeSource === "camera" ? "Telefoon" : "Scherm"}
      </div>
    </main>
  );
}
