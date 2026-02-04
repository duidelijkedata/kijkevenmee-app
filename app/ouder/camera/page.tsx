"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

type SignalMsg =
  | { type: "hello"; at: number }
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any };

export default function OuderCameraPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [status, setStatus] = useState<"idle" | "resolving" | "ready" | "connecting" | "connected" | "error">("idle");
  const [errorText, setErrorText] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [token, setToken] = useState<string>("");

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);

  useEffect(() => {
    const u = new URL(window.location.href);
    const t = u.searchParams.get("token") || "";
    setToken(t);
  }, []);

  // Resolve token -> support code
  useEffect(() => {
    if (!token) return;

    (async () => {
      setStatus("resolving");
      setErrorText("");

      try {
        const res = await fetch(`/api/support/camera-token/${encodeURIComponent(token)}`, { method: "GET" });
        const json = await res.json();

        if (!res.ok) {
          setStatus("error");
          setErrorText(json?.error || "Kon token niet valideren.");
          return;
        }

        setCode(json.code);
        setStatus("ready");
      } catch (e: any) {
        setStatus("error");
        setErrorText("Netwerkfout bij token validatie.");
      }
    })();
  }, [token]);

  // Setup realtime channel (camera signaling)
  useEffect(() => {
    if (!code) return;

    const ch = supabase.channel(`signalcam:${code}`);
    channelRef.current = ch;

    ch.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;

      try {
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
        setErrorText("Fout in verbinding (signaling).");
      }
    });

    ch.subscribe();

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {}
    };
  }, [supabase, code]);

  async function stop() {
    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;

    try {
      streamRef.current?.getTracks()?.forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;

    if (videoPreviewRef.current) {
      try {
        (videoPreviewRef.current as any).srcObject = null;
      } catch {}
    }

    setStatus(code ? "ready" : "idle");
    setErrorText("");
  }

  async function startCamera() {
    if (!code) return;

    setStatus("connecting");
    setErrorText("");

    await stop();

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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      track.addEventListener("ended", () => stop());

      pc.addTrack(track, stream);

      // lokale preview (handig voor ouder om te zien wat je filmt)
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.playsInline = true;
        await videoPreviewRef.current.play().catch(() => {});
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "offer", sdp: offer } satisfies SignalMsg,
      });

      // “hello” kan helpen als kind later subscribed
      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "hello", at: Date.now() } satisfies SignalMsg,
      });

      setStatus("connecting");
    } catch (e: any) {
      console.error(e);
      setStatus("error");
      setErrorText(e?.message || "Kon camera niet starten. Geef toestemming in je browser.");
      await stop();
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto w-full max-w-md space-y-3">
        <Card>
          <h1 className="text-xl font-semibold">Telefoon als camera</h1>
          <p className="text-slate-600 mt-1">
            Gebruik je telefoon als losse camera. Richt hem op wat je wilt laten zien (router, brief, toetsenbord, etc.).
          </p>

          <div className="mt-4 rounded-xl overflow-hidden bg-black">
            <video ref={videoPreviewRef} className="w-full h-auto" />
          </div>

          {status === "error" && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">{errorText}</div>
          )}

          <div className="mt-4 flex gap-2">
            <Button
              variant="primary"
              onClick={startCamera}
              disabled={status === "resolving" || status === "connecting" || status === "connected" || !code}
              className="flex-1"
            >
              {status === "connecting" || status === "connected" ? "Camera draait" : "Start camera"}
            </Button>
            <Button onClick={stop} disabled={status === "resolving"} className="w-28">
              Stop
            </Button>
          </div>

          <div className="mt-3 text-sm text-slate-600">
            Status:{" "}
            <span className="font-medium text-slate-900">
              {status === "resolving"
                ? "Koppelen…"
                : status === "ready"
                  ? "Klaar"
                  : status === "connecting"
                    ? "Verbinden…"
                    : status === "connected"
                      ? "Verbonden"
                      : status === "error"
                        ? "Fout"
                        : "Idle"}
            </span>
          </div>

          {/* alleen debug/handig */}
          {code ? <div className="mt-2 text-xs text-slate-500">Sessie: {code}</div> : null}
        </Card>

        <div className="text-xs text-slate-500 text-center">
          Tip: zet je telefoon in landscape voor een bredere view.
        </div>
      </div>
    </main>
  );
}
