"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

type ActiveSource = "screen" | "camera";

type SignalMsg =
  | { type: "hello"; at: number }
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any };

type MainSignalMsg = { type: "active_source"; source: ActiveSource };

export default function OuderCameraPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [status, setStatus] = useState<"idle" | "resolving" | "ready" | "connecting" | "connected" | "error">("idle");
  const [errorText, setErrorText] = useState<string>("");

  const [code, setCode] = useState<string>("");
  const [token, setToken] = useState<string>("");

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);

  // camera signaling kanaal
  const channelRef = useRef<any>(null);
  // hoofd-kanaal voor active_source switch
  const mainChannelRef = useRef<any>(null);

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
        // Let op: dit endpoint moet bestaan in jouw app (jij hebt ‘m al werkend gekregen)
        const res = await fetch(`/api/support/camera/validatie?token=${encodeURIComponent(token)}`, { method: "GET" });
        const json = await res.json();

        if (!res.ok) {
          setStatus("error");
          setErrorText(json?.error || "Kon token niet valideren.");
          return;
        }

        setCode(json.code);
        setStatus("ready");
      } catch {
        setStatus("error");
        setErrorText("Netwerkfout bij token validatie.");
      }
    })();
  }, [token]);

  // Setup realtime channels
  useEffect(() => {
    if (!code) return;

    // Camera signaling (WebRTC)
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

    // Hoofd kanaal om active_source te sturen (geen listener nodig)
    const main = supabase.channel(`signal:${code}`);
    mainChannelRef.current = main;

    ch.subscribe();
    main.subscribe();

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {}
      try {
        supabase.removeChannel(main);
      } catch {}
      channelRef.current = null;
      mainChannelRef.current = null;
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

  async function broadcastActiveSource(source: ActiveSource) {
    const main = mainChannelRef.current;
    if (!main) return;
    try {
      await main.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "active_source", source } satisfies MainSignalMsg,
      });
    } catch (e) {
      // niet fatal; camera kan nog steeds streamen, maar kind switcht dan niet
      console.warn("broadcastActiveSource failed", e);
    }
  }

  async function startCamera() {
    if (!code) return;

    setErrorText("");

    // Eerst opruimen (oude pc/stream), daarna status
    await stop();
    setStatus("connecting");

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
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });

      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      track.addEventListener("ended", () => void stop());

      pc.addTrack(track, stream);

      // lokale preview
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.playsInline = true;
        await videoPreviewRef.current.play().catch(() => {});
      }

      // ✅ BELANGRIJK: PAS NU schakelen we het kind over naar telefoon
      await broadcastActiveSource("camera");

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "offer", sdp: offer } satisfies SignalMsg,
      });

      // “hello” helpt bij later subscriben
      await channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "hello", at: Date.now() } satisfies SignalMsg,
      });

      // status blijft connecting tot answer binnen is
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

          {code ? <div className="mt-2 text-xs text-slate-500">Sessie: {code}</div> : null}
        </Card>

        <div className="text-xs text-slate-500 text-center">Tip: zet je telefoon in landscape voor een bredere view.</div>
      </div>
    </main>
  );
}
