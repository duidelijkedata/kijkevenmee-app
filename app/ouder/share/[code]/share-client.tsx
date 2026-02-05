"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

import FullscreenShell from "@/components/meekijk/FullscreenShell";
import ViewerStage from "@/components/meekijk/ViewerStage";

type Quality = "low" | "medium" | "high";
type ActiveSource = "screen" | "camera" | "none";

type SignalMsg =
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any }
  | { type: "quality"; quality: Quality }
  | { type: "active_source"; source: ActiveSource }
  | { type: "phone_camera_link"; link: string | null }
  | { type: "phone_camera_preview_jpeg"; jpeg: string; ts?: number }
  | { type: "phone_camera_live"; live: boolean }
  | { type: "phone_camera_error"; message: string }
  | { type: "stop_phone_camera" }
  | { type: "ping" };

function now() {
  return Date.now();
}

// basic safe base64url-ish
function randomToken(len = 32) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function qrUrl(text: string) {
  // Keep it simple, rely on public QR image service already used elsewhere in project
  return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(text)}`;
}

export default function ShareClient({ code }: { code: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pcCamRef = useRef<RTCPeerConnection | null>(null);

  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const sendersRef = useRef<RTCRtpSender[]>([]);
  const sendersCamRef = useRef<RTCRtpSender[]>([]);

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");

  const [quality, setQuality] = useState<Quality>("medium");
  const [activeSource, setActiveSource] = useState<ActiveSource>("none");

  // ===== Overlay: extra phone camera =====
  const [camOverlayOpen, setCamOverlayOpen] = useState(false);
  const [camLink, setCamLink] = useState<string | null>(null);
  const [camLoading, setCamLoading] = useState(false);
  const [camError, setCamError] = useState("");

  // preview from phone (jpeg)
  const [camPreviewJpeg, setCamPreviewJpeg] = useState<string>("");
  const [camPreviewAt, setCamPreviewAt] = useState<number>(0);
  const [camLive, setCamLive] = useState<boolean>(false);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // phone camera token link
  async function createPhoneCameraLink() {
    setCamLoading(true);
    try {
      const token = randomToken(32);
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const link = `${origin}/ouder/camera?token=${token}&code=${encodeURIComponent(code)}`;

      // broadcast to child (and store locally)
      setCamLink(link);
      await sendSignal({ type: "phone_camera_link", link });

      // also store in DB if your flow expects it (keep as-is)
      // If your project uses a table, keep your existing RPC; here we only broadcast.
    } catch (e: any) {
      setCamError(e?.message ?? "Kon geen link maken");
      await sendSignal({ type: "phone_camera_error", message: e?.message ?? "Kon geen link maken" });
    } finally {
      setCamLoading(false);
    }
  }

  function phoneIsLiveNow() {
    // if we received a recent preview or explicit live flag
    if (camLive) return true;
    if (!camPreviewAt) return false;
    return now() - camPreviewAt < 5000;
  }

  // ✅ NEW: open overlay direct in “QR screen” (geen tussenstap)
  async function openExtraCameraOverlay() {
    const liveNow = phoneIsLiveNow();

    // reset UI alleen als niet live
    if (!liveNow) {
      setCamLive(false);
      setCamPreviewJpeg("");
      setCamPreviewAt(0);
      setCamError("");
      setCamLink(null);
      await createPhoneCameraLink();
    }

    setCamOverlayOpen(true);
  }

  async function stopPhoneCamera() {
    setCamLive(false);
    setCamPreviewJpeg("");
    setCamPreviewAt(0);

    // tell child to stop using phone camera
    await sendSignal({ type: "stop_phone_camera" });

    // reflect locally
    setActiveSource("screen");
    await sendSignal({ type: "active_source", source: "screen" });
  }

  // ===== Signaling =====
  async function sendSignal(msg: SignalMsg) {
    // broadcast on a known channel name
    try {
      const ch = channelRef.current;
      if (!ch) return;
      await ch.send({
        type: "broadcast",
        event: "signal",
        payload: msg,
      });
    } catch {
      // ignore
    }
  }

  // ===== WebRTC: screen share =====
  async function createPcIfNeeded() {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (ev) => {
      if (ev.candidate) void sendSignal({ type: "ice", candidate: ev.candidate });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setConnected(true);
        setStatus("connected");
      }
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setConnected(false);
        if (status !== "idle") setStatus("error");
      }
    };

    pc.ontrack = (ev) => {
      const stream = ev.streams?.[0];
      if (stream && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play?.().catch(() => {});
      }
    };

    pcRef.current = pc;
    return pc;
  }

  // ===== WebRTC: phone camera peer (optional separate PC) =====
  async function createPcCamIfNeeded() {
    if (pcCamRef.current) return pcCamRef.current;

    const pcCam = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pcCam.onicecandidate = (ev) => {
      if (ev.candidate) void sendSignal({ type: "ice", candidate: ev.candidate });
    };

    pcCam.onconnectionstatechange = () => {
      // no-op: we keep main status in screen pc
    };

    pcCam.ontrack = (ev) => {
      const stream = ev.streams?.[0];
      if (stream && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play?.().catch(() => {});
      }
    };

    pcCamRef.current = pcCam;
    return pcCam;
  }

  async function startConnection() {
    setStatus("connecting");

    const pc = await createPcIfNeeded();

    // Create offer
    const offer = await pc.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: true,
    });
    await pc.setLocalDescription(offer);
    await sendSignal({ type: "offer", sdp: offer });
  }

  async function applyAnswer(sdp: any) {
    const pc = await createPcIfNeeded();
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async function applyOffer(sdp: any) {
    const pc = await createPcIfNeeded();
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendSignal({ type: "answer", sdp: answer });
  }

  async function applyIce(candidate: any) {
    // both pcs may receive candidates; add where possible
    const pcs = [pcRef.current, pcCamRef.current].filter(Boolean) as RTCPeerConnection[];
    await Promise.all(
      pcs.map(async (pc) => {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // ignore
        }
      })
    );
  }

  // ===== Subscribe to signaling =====
  useEffect(() => {
    const ch = supabase.channel(`signal:${code}`);
    channelRef.current = ch;

    ch.on("broadcast", { event: "signal" }, ({ payload }) => {
      const msg = payload as SignalMsg;

      if (msg.type === "offer") {
        void applyOffer(msg.sdp);
        return;
      }
      if (msg.type === "answer") {
        void applyAnswer(msg.sdp);
        return;
      }
      if (msg.type === "ice") {
        void applyIce(msg.candidate);
        return;
      }
      if (msg.type === "quality") {
        setQuality(msg.quality);
        return;
      }
      if (msg.type === "active_source") {
        setActiveSource(msg.source);
        return;
      }

      // phone camera overlay/preview
      if (msg.type === "phone_camera_link") {
        setCamLink(msg.link);
        return;
      }
      if (msg.type === "phone_camera_preview_jpeg") {
        setCamPreviewJpeg(msg.jpeg);
        setCamPreviewAt(msg.ts ?? now());
        return;
      }
      if (msg.type === "phone_camera_live") {
        setCamLive(msg.live);
        return;
      }
      if (msg.type === "phone_camera_error") {
        setCamError(msg.message);
        return;
      }
      if (msg.type === "stop_phone_camera") {
        setCamLive(false);
        setCamPreviewJpeg("");
        setCamPreviewAt(0);
        setActiveSource("screen");
        return;
      }
    });

    ch.subscribe();

    return () => {
      try {
        ch.unsubscribe();
      } catch {}
      channelRef.current = null;
    };
  }, [supabase, code]);

  // ===== Start on mount =====
  useEffect(() => {
    void startConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== UI =====
  const showPhoneLive = phoneIsLiveNow();

 return (
  <FullscreenShell sidebar={<div />}>
    <div className="h-full w-full flex">
        {/* Main viewer */}
        <div className="flex-1 min-w-0 relative">
          <ViewerStage>
            <video
              ref={remoteVideoRef}
              className="w-full h-full object-contain bg-black"
              playsInline
              muted
              autoPlay
            />
          </ViewerStage>

          {/* Overlay open button (example: you likely already have a trigger elsewhere) */}
          <div className="absolute top-4 right-4 z-10">
            <Button onClick={() => void openExtraCameraOverlay()} variant="secondary">
              Extra camera koppelen
            </Button>
          </div>
        </div>

        {/* ===== Extra Camera Overlay ===== */}
        {camOverlayOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl border p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold">Telefoon als extra camera</div>
                  <div className="text-sm text-slate-600">Scan de QR-code met je telefoon en start daar de camera.</div>
                </div>

                <Button
                  variant="ghost"
                  className="h-9 w-9 p-0"
                  onClick={() => {
                    setCamOverlayOpen(false);
                  }}
                >
                  ✕
                </Button>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border p-3">
                  <div className="aspect-square w-full overflow-hidden rounded-lg bg-slate-100 flex items-center justify-center">
                    {camLoading || !camLink ? (
                      <div className="text-sm text-slate-500">QR-code wordt gemaakt…</div>
                    ) : (
                      <>
                        <img src={qrUrl(camLink)} alt="QR code" className="w-full h-auto rounded-lg bg-white" />
                        <div className="text-xs text-slate-500 mt-2">Scan met iPhone/Android camera app of QR scanner.</div>
                      </>
                    )}
                  </div>

                  <div className="mt-3 text-xs text-slate-500">Kind ziet nu: {activeSource === "camera" ? "Telefoon" : "Scherm"}</div>
                </div>

                {/* ✅ AANGEPAST: Koppellink + Kopieer link verwijderd, Vernieuw blijft */}
                <div className="rounded-xl border p-3">
                  <div className="flex items-center justify-end">
                    <Button
                      onClick={() => {
                        setCamError("");
                        void createPhoneCameraLink();
                      }}
                      className="w-28"
                      disabled={camLoading}
                    >
                      Vernieuw
                    </Button>
                  </div>

                  <div className="mt-3 text-xs text-slate-500">
                    Tip: open de link op de telefoon en kies “Sta camera toe”.
                  </div>
                  <div className="mt-3 text-xs text-slate-500 text-right">Link verloopt na ±30 minuten.</div>

                  {/* preview panel */}
                  <div className="mt-4 rounded-xl border bg-slate-50 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">Preview</div>
                      <div className="text-xs text-slate-500">{showPhoneLive ? "Live" : "Wachten…"}</div>
                    </div>

                    <div className="mt-2 aspect-video w-full overflow-hidden rounded-lg bg-black flex items-center justify-center">
                      {camPreviewJpeg ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={camPreviewJpeg} alt="preview" className="w-full h-full object-contain" />
                      ) : (
                        <div className="text-xs text-slate-400">Nog geen preview</div>
                      )}
                    </div>

                    <div className="mt-3 flex gap-2">
                      <Button
                        onClick={() => void stopPhoneCamera()}
                        variant="secondary"
                        className="flex-1"
                        disabled={!showPhoneLive && activeSource !== "camera"}
                      >
                        Stop gebruik telefoon
                      </Button>
                    </div>

                    {camError ? <div className="mt-2 text-xs text-red-600">{camError}</div> : null}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between">
                <div className="text-xs text-slate-500">
                  Status:{" "}
                  <span className="font-medium">
                    {status === "connected" ? "Verbonden" : status === "connecting" ? "Verbinden…" : status === "error" ? "Fout" : "Inactief"}
                  </span>
                  {" · "}
                  Kwaliteit: <span className="font-medium">{quality}</span>
                </div>

                <Button
                  onClick={() => setCamOverlayOpen(false)}
                  variant="secondary"
                >
                  Sluiten
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </FullscreenShell>
  );
}
