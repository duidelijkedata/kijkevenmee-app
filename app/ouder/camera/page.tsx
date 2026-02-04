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

  useEffect(() => {
    const u = new URL(window.location.href);
    const t = u.searchParams.get("token") || "";
    setToken(t);
  }, []);

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

    try {
      if (previewTimerRef.current) clearInterval(previewTimerRef.current);
    } catch {}
    previewTimerRef.current = null;

    setErrorText("");
    setStatus(code ? "ready" : "idle");
  }

  async function resolveTokenToCode(t: string): Promise<string> {
    // We proberen meerdere endpoints omdat jouw project history laat zien
    // dat deze route-namen vaker verschuiven.
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
        // sommige varianten returnen { support_code: ... }
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

  // Resolve token -> support code
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

  // Setup realtime channels zodra code bekend is
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

  function fireActiveSourceCamera() {
    const main = mainChannelRef.current;
    if (!main) return;

    // Fire-and-forget: mag nooit je Start Camera blokkeren
    main
      .send({
        type: "broadcast",
        event: "signal",
        payload: { type: "active_source", source: "camera" } satisfies MainSignalMsg,
      })
      .catch((e: any) => {
        console.warn("active_source broadcast failed", e);
      });
  }

  function sendCamPreview(jpeg: string) {
    const main = mainChannelRef.current;
    if (!main) return;
    main
      .send({
        type: "broadcast",
        event: "signal",
        payload: { type: "cam_preview", jpeg, at: Date.now() } satisfies MainSignalMsg,
      })
      .catch(() => {});
  }

  function startPreviewLoop() {
    try {
      if (previewTimerRef.current) clearInterval(previewTimerRef.current);
    } catch {}
    previewTimerRef.current = null;

    // ~2 fps is genoeg voor een “live preview” in de overlay zonder Supabase te spammen
    previewTimerRef.current = setInterval(() => {
      const v = videoPreviewRef.current;
      const c = previewCanvasRef.current;
      if (!v || !c) return;
      if (v.readyState < 2) return;

      const w = v.videoWidth || 0;
      const h = v.videoHeight || 0;
      if (!w || !h) return;

      // schaal down voor lightweight preview
      const maxW = 360;
      const scale = Math.min(1, maxW / w);
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));

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

  useEffect(() => {
    return () => {
      try {
        if (previewTimerRef.current) clearInterval(previewTimerRef.current);
      } catch {}
      previewTimerRef.current = null;

      // best-effort stoppen van media/pc
      try {
        pcRef.current?.close();
      } catch {}
      try {
        streamRef.current?.getTracks()?.forEach((t) => t.stop());
      } catch {}
    };
  }, []);

  async function startCamera() {
    if (!code) return;

    setErrorText("");
    setStatus("connecting");

    // opruimen oude stream/pc
    await stop();
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
      track.addEventListener("ended", () => void stop());

      pc.addTrack(track, stream);

      // lokale preview
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.playsInline = true;
        await videoPreviewRef.current.play().catch(() => {});
      }

      // start live preview frames voor de overlay op /ouder/share
      startPreviewLoop();

      // ✅ pas NU switchen we het kind naar de telefoonbron
      fireActiveSourceCamera();

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

          <div className="mt-4 rounded-xl overflow-hidden border bg-white">
            <video ref={videoPreviewRef} className="w-full rounded-xl bg-black" playsInline muted />
            <canvas ref={previewCanvasRef} className="hidden" />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="primary"
              onClick={startCamera}
              disabled={status === "resolving" || status === "connecting" || status === "connected" || !code}
              className="flex-1"
            >
              {status === "connecting" || status === "connected" ? "Camera draait…" : "Start camera"}
            </Button>

            <Button
              onClick={async () => {
                // als iemand op de telefoon stopt, schakelen we het kind weer terug
                try {
                  await mainChannelRef.current?.send({
                    type: "broadcast",
                    event: "signal",
                    payload: { type: "active_source", source: "screen" } satisfies MainSignalMsg,
                  });
                } catch {}
                await stop();
              }}
              disabled={status === "resolving"}
              className="w-28"
            >
              Stop
            </Button>
          </div>

          <div className="mt-3 text-sm text-slate-600">
            Status: <span className="font-semibold">{status}</span>
            {code ? <span className="text-slate-400"> • sessie {code}</span> : null}
          </div>

          {errorText ? <div className="mt-2 text-sm text-red-600">{errorText}</div> : null}
        </Card>

        <div className="text-xs text-slate-500">
          Tip: als je telefoon de “Start camera” knop niet laat werken, check camera-permissies in je browser en refresh de pagina.
        </div>
      </div>
    </main>
  );
}
