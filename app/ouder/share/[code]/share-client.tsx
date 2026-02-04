"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

import FullscreenShell from "@/components/meekijk/FullscreenShell";
import ViewerStage from "@/components/meekijk/ViewerStage";

type Quality = "low" | "medium" | "high";
type ActiveSource = "screen" | "camera" | "none";

type DraftShape =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number };

type DrawPacket = {
  id: string;
  createdAt: number;
  snapshotJpeg: string;
  shapes: DraftShape[];
};

type SignalMsg =
  | { type: "hello"; at: number }
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any }
  | { type: "quality"; quality: Quality }
  | { type: "draw_packet"; packet: DrawPacket }
  | { type: "active_source"; source: ActiveSource }
  | { type: "cam_preview"; jpeg: string; at: number };

type PacketState = DrawPacket & { seen: boolean };

function qualityLabel(q: Quality) {
  if (q === "low") return "Laag";
  if (q === "medium") return "Medium";
  return "Hoog";
}

function qualityParams(q: Quality) {
  if (q === "low") return { maxBitrate: 2_500_000, idealFps: 15, maxFps: 20 };
  if (q === "medium") return { maxBitrate: 8_000_000, idealFps: 30, maxFps: 30 };
  return { maxBitrate: 12_000_000, idealFps: 30, maxFps: 60 };
}

export default function ShareClient({ code }: { code: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [status, setStatus] = useState<"idle" | "sharing" | "connected" | "error">("idle");

  const [quality, setQuality] = useState<Quality>("medium");
  const [debugLine, setDebugLine] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const channelRef = useRef<any>(null);
  const lastOfferRef = useRef<any>(null);

  const statsTimerRef = useRef<any>(null);
  const lastBytesSentRef = useRef<number | null>(null);
  const lastStatsAtRef = useRef<number | null>(null);

  const [packets, setPackets] = useState<PacketState[]>([]);
  const [activePacketId, setActivePacketId] = useState<string | null>(null);

  const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://kijkevenmee-app.vercel.app";

  // ===== Telefoon overlay state =====
  const [camOpen, setCamOpen] = useState(false);
  const [camLoading, setCamLoading] = useState(false);
  const [camError, setCamError] = useState("");
  const [camLink, setCamLink] = useState("");
  const [activeSource, setActiveSource] = useState<ActiveSource>("screen");

  const [camPreviewJpeg, setCamPreviewJpeg] = useState("");
  const [camPreviewAt, setCamPreviewAt] = useState(0);

  async function broadcastActiveSource(source: ActiveSource) {
    setActiveSource(source);
    await channelRef.current?.send({
      type: "broadcast",
      event: "signal",
      payload: { type: "active_source", source } satisfies SignalMsg,
    });
  }

  function qrUrl(data: string) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(data)}`;
  }

  async function createPhoneCameraLink() {
    setCamLoading(true);
    setCamError("");
    setCamLink("");

    try {
      const res = await fetch(`/api/support/${encodeURIComponent(code)}/camera-token`, { method: "POST" });
      const json = await res.json();

      if (!res.ok) throw new Error(json?.error || "Fout");

      setCamLink(`${origin}/ouder/camera?token=${json.token}`);
    } catch {
      setCamError("Kon QR-link niet maken.");
    } finally {
      setCamLoading(false);
    }
  }

  // ===== Signaling =====
  useEffect(() => {
    const ch = supabase.channel(`signal:${code}`);
    channelRef.current = ch;

    ch.on("broadcast", { event: "signal" }, async ({ payload }: any) => {
      const msg = payload as SignalMsg;

      if (msg.type === "hello" && lastOfferRef.current) {
        await ch.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "offer", sdp: lastOfferRef.current },
        });
        return;
      }

      if (msg.type === "cam_preview") {
        setCamPreviewJpeg(msg.jpeg);
        setCamPreviewAt(msg.at);
        return;
      }

      if (msg.type === "active_source") {
        setActiveSource(msg.source);
        return;
      }

      if (msg.type === "draw_packet") {
        setPackets((p) => [...p, { ...msg.packet, seen: false }]);
        setActivePacketId(msg.packet.id);
        return;
      }

      const pc = pcRef.current;
      if (!pc) return;

      if (msg.type === "answer") {
        await pc.setRemoteDescription(msg.sdp);
        setStatus("connected");
      }
      if (msg.type === "ice") {
        await pc.addIceCandidate(msg.candidate);
      }
    });

    ch.subscribe();
    return () => supabase.removeChannel(ch);
  }, [supabase, code]);

  async function startShare() {
    if (status !== "idle") return;

    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pcRef.current = pc;

    pc.onicecandidate = (e) =>
      e.candidate &&
      channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "ice", candidate: e.candidate },
      });

    const qp = qualityParams(quality);
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: qp.idealFps, max: qp.maxFps } },
      audio: false,
    });

    streamRef.current = stream;
    pc.addTrack(stream.getVideoTracks()[0], stream);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    lastOfferRef.current = offer;

    await channelRef.current?.send({
      type: "broadcast",
      event: "signal",
      payload: { type: "offer", sdp: offer },
    });

    await broadcastActiveSource("screen");
    setStatus("sharing");
  }

  async function stopUsingPhone() {
    setCamOpen(false);
    setCamPreviewJpeg("");
    await broadcastActiveSource("screen");
    if (status === "idle") await startShare();
  }

  return (
    <FullscreenShell sidebar={null}>
      {/* ===== Telefoon overlay ===== */}
      {camOpen && (
        <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            {!camPreviewJpeg ? (
              <>
                <h2 className="text-lg font-semibold">Telefoon als camera</h2>
                <p className="text-sm text-slate-600 mt-1">
                  Scan de QR-code en start de camera op je telefoon.
                </p>

                <div className="mt-4">
                  {!camLink && (
                    <Button onClick={createPhoneCameraLink} disabled={camLoading}>
                      {camLoading ? "Bezig…" : "Maak QR-code"}
                    </Button>
                  )}

                  {camLink && (
                    <img src={qrUrl(camLink)} className="mt-3 rounded-xl bg-white" />
                  )}

                  {camError && <div className="mt-3 text-red-600 text-sm">{camError}</div>}
                </div>
              </>
            ) : (
              <>
                <div className="aspect-[9/16] rounded-xl overflow-hidden bg-black">
                  <img
                    src={camPreviewJpeg}
                    className="w-full h-full object-cover"
                    style={{ transform: "translateZ(0)" }}
                  />
                </div>

                <Button className="mt-4 w-full" onClick={stopUsingPhone}>
                  Stop gebruik telefoon
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== Main UI ===== */}
      <div className="h-screen w-screen bg-black">
        <ViewerStage>
          <video ref={videoRef} className="max-h-full max-w-full" />
        </ViewerStage>

        <div className="fixed bottom-4 left-4 z-50 flex gap-2">
          <Button onClick={startShare} disabled={status !== "idle"}>
            Start delen
          </Button>
          <Button
            onClick={async () => {
              setCamOpen(true);
              await broadcastActiveSource("camera");
            }}
          >
            Telefoon als camera
          </Button>
        </div>
      </div>
    </FullscreenShell>
  );
}
