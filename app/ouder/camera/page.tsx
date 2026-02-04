"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

type ActiveSource = "screen" | "camera";

type CamSignalMsg =
  | { type: "hello"; at: number }
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any };

type MainSignalMsg =
  | { type: "active_source"; source: ActiveSource }
  | { type: "cam_preview"; jpeg: string; at: number };

export default function OuderCameraPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [status, setStatus] = useState<"idle" | "resolving" | "ready" | "connecting" | "connected" | "error">("idle");
  const [errorText, setErrorText] = useState<string>("");

  const [code, setCode] = useState<string>("");
  const [token, setToken] = useState<string>("");

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewTimerRef = useRef<any>(null);

  const streamRef = useRef<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);

  const camChannelRef = useRef<any>(null); // signalcam:${code}
  const mainChannelRef = useRef<any>(null); // signal:${code}

  // ✅ throttle voor active_source refresh
  const lastCameraActivePingRef = useRef<number>(0);

  useEffect(() => {
    const u = new URL(window.location.href);
    const t = u.searchParams.get("token") || "";
    setToken(t);
  }, []);

  function stopPreviewLoop() {
    try {
      if (previewTimerRef.current) clearInterval(previewTimerRef.current);
    } catch {}
    previewTimerRef.current = null;
  }

  async function broadcastActiveSource(source: ActiveSource) {
    const main = mainChannelRef.current;
    if (!main) return;

    await main.send({
      type: "broadcast",
      event: "signal",
      payload: { type: "active_source", source } satisfies MainSignalMsg,
    });
  }

  function sendCamPreview(jpeg: string) {
    const main = mainChannelRef.current;
    if (!main) return;

    // 1) preview frame
    main
      .send({
        type: "broadcast",
        event: "signal",
        payload: { type: "cam_preview", jpeg, at: Date.now() } satisfies MainSignalMsg,
      })
      .catch(() => {});

    // 2) ✅ elke ~2s ook active_source=camera “refreshen”
    const now = Date.now();
    if (now - lastCameraActivePingRef.current > 2000) {
      lastCameraActivePingRef.current = now;
      main
        .send({
          type: "broadcast",
          event: "signal",
          payload: { type: "active_source", source: "camera" } satisfies MainSignalMsg,
        })
        .catch(() => {});
    }
  }

  function startPreviewLoop() {
    stopPreviewLoop();

    previewTimerRef.current = setInterval(() => {
      const v = videoPreviewRef.current;
      const c = previewCanvasRef.current;
      if (!v || !c) return;
      if (v.readyState < 2) return;

      const vw = v.videoWidth || 0;
      const vh = v.videoHeight || 0;
      if (!vw || !vh) return;

      const maxW = 360;
      const scale = Math.min(1, maxW / vw);
      const tw = Math.max(1, Math.round(vw * scale));
      const th = Math.max(1, Math.round(vh * scale));

      c.width = tw;
      c.height = th;

      const ctx = c.getContext("2d");
      if (!ctx) return;

      try {
        ctx.drawImage(v, 0, 0, tw, th);
        const jpeg = c.toDataURL("image/jpeg", 0.6);
        if (jpeg && jpeg.startsWith("data:image/jpeg")) {
          sendCamPreview(jpeg);
        }
      } catch {
        // ignore
      }
    }, 500);
  }

  async function stop(sendBackToScreen: boolean = true) {
    stopPreviewLoop();

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

    if (sendBackToScreen) {
      try {
        await broadcastActiveSource("screen");
      } catch {}
    }

    setErrorText("");
    setStatus(code ? "ready" : "idle");
  }

  async function resolveTokenToCode(t: string): Promise<string> {
    const candidates: Array<{ url: string; parse: (json: any) => string | null }> = [
      {
        url: `/api/support/camera/validatie?token=${encodeURIComponent(t)}`,
        parse: (j) => (typeof j?.code === "string" ? j.code : null),
      },
      {
        url: `/api/support/camera/validate?token=${encodeURIComponent(t)}`,
        parse: (j) => (typeof j?.code === "string" ? j.code : null),
      },
      {
        url: `/api/support/camera-token/${encodeURIComponent(t)}`,
        parse: (j) => (typeof j?.code === "string" ? j.code : null),
      },
      {
        url: `/api/support/camera-token/${encodeURIComponent(t)}`,
        parse: (j) => (typeof j?.support_code === "string" ? j.support_code : null),
      },
    ];

    let lastErr = "";

    for (const c of candidates) {
      try {
        const res = await fetch(c.url, { method: "GET" });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          lastErr = json?.error || `HTTP ${res.status}`;
          continue;
        }

        const maybe = c.parse(json);
        if (maybe) return maybe;

        lastErr = "Response bevat geen code.";
      } catch (e: any) {
        lastErr = e?.message || "Netwerkfout";
      }
    }

    throw new Error(lastErr || "Kon token niet valideren.");
  }

  useEffect(() => {
    if (!token) return;

    (async () => {
      setStatus("resolving");
      setErrorText("");
      setCode("");

      try {
        const c = await resolveTokenToCode(token);
        setCode(c);
        setStatus("ready");
      } catch (e: any) {
        setStatus("error");
        setErrorText(e?.message || "Kon token niet valideren.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!code) return;

    const camCh = supabase.channel(`signalcam:${code}`);
    camChannelRef.current = camCh;

    camCh.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as CamSignalMsg;
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

    const mainCh = supabase.channel(`signal:${code}`);
    mainChannelRef.current = mainCh;

    camCh.subscribe();
    mainCh.subscribe();

    return () => {
      try {
        supabase.removeChannel(camCh);
      } catch {}
      try {
        supabase.removeChannel(mainCh);
      } catch {}
      camChannelRef.current = null;
      mainChannelRef.current = null;
    };
  }, [supabase, code]);

  async function startCamera() {
    if (!code) return;

    setErrorText("");
    setStatus("connecting");
    lastCameraActivePingRef.current = 0;

    await stop(false);
    setStatus("connecting");

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate && camChannelRef.current) {
        camChannelRef.current.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "ice", candidate: e.candidate } satisfies CamSignalMsg,
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
      track.addEventListener("ended", () => void stop(true));

      pc.addTrack(track, stream);

      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.playsInline = true;
        await videoPreviewRef.current.play().catch(() => {});
      }

      // Preview loop start
      startPreviewLoop();

      // Direct switch to camera once started
      try {
        await broadcastActiveSource("camera");
      } catch {}

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await camChannelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "offer", sdp: offer } satisfies CamSignalMsg,
      });

      await camChannelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "hello", at: Date.now() } satisfies CamSignalMsg,
      });

      setStatus("connecting");
    } catch (e: any) {
      console.error(e);
      setStatus("error");
      setErrorText(e?.message || "Kon camera niet starten. Geef toestemming in je browser.");
      await stop(true);
    }
  }

  useEffect(() => {
    return () => {
      stopPreviewLoop();
      try {
        pcRef.current?.close();
      } catch {}
      try {
        streamRef.current?.getTracks()?.forEach((t) => t.stop());
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            <canvas ref={previewCanvasRef} className="hidden" />
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
            <Button onClick={() => void stop(true)} disabled={status === "resolving"} className="w-28">
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
