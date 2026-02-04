"use client";

import type React from "react";
import { useMemo, useRef, useState, useEffect } from "react";
import { Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

import FullscreenShell from "@/components/meekijk/FullscreenShell";
import ViewerStage from "@/components/meekijk/ViewerStage";

type Quality = "low" | "medium" | "high";
type ActiveSource = "screen" | "camera";
type DrawTool = "circle" | "rect" | "arrow";

type DraftShape =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number };

type DrawPacket = {
  id: string;
  createdAt: number;
  snapshotJpeg: string; // data URL
  shapes: DraftShape[];
};

type SignalMsg =
  | { type: "hello"; at: number }
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any }
  | { type: "quality"; quality: Quality }
  | { type: "draw_packet"; packet: DrawPacket }
  | { type: "active_source"; source: ActiveSource };

function formatCode(v: string) {
  const digits = v.replace(/\D/g, "").slice(0, 6);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function uid() {
  return Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

export default function KindVerbinden() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [code, setCode] = useState("");

  // Als 'Meekijken starten met code' UIT staat, tonen we sessies die al aan jou zijn toegewezen.
  const [useKoppelcode, setUseKoppelcode] = useState<boolean>(true);
  const [activeSessions, setActiveSessions] = useState<
    { id: string; code: string; requester_name?: string | null; created_at?: string }[]
  >([]);
  const [activeError, setActiveError] = useState<string | null>(null);

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [connectHint, setConnectHint] = useState<string | null>(null);
  const gotAnySignalRef = useRef(false);
  const waitHintTimerRef = useRef<number | null>(null);
  const connectAttemptRef = useRef(0);

  const [remoteQuality, setRemoteQuality] = useState<Quality | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pcCamRef = useRef<RTCPeerConnection | null>(null);

  const channelRef = useRef<any>(null);
  const channelCamRef = useRef<any>(null);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);

  const activeSourceRef = useRef<ActiveSource>("screen");
  const [activeSource, setActiveSource] = useState<ActiveSource>("screen");

  // Canvas + annotate
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [annotate, setAnnotate] = useState(false);
  const [tool, setTool] = useState<DrawTool>("circle");

  const [drawing, setDrawing] = useState<null | { startX: number; startY: number; currentX: number; currentY: number }>(
    null
  );
  const [shapes, setShapes] = useState<DraftShape[]>([]);
  const [needsTapToPlay, setNeedsTapToPlay] = useState(false);

  // pan/zoom
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);

  function attachStream(stream: MediaStream | null) {
    const v = videoRef.current;
    if (!v) return;

    if (!stream) {
      try {
        (v as any).srcObject = null;
      } catch {}
      return;
    }

    setNeedsTapToPlay(false);

    v.srcObject = stream;
    v.muted = true;
    v.playsInline = true;
    // @ts-ignore
    v.disablePictureInPicture = true;

    const tryPlay = async () => {
      try {
        await v.play();
        setNeedsTapToPlay(false);
      } catch {
        setNeedsTapToPlay(true);
      }
    };

    void tryPlay();
    v.onloadedmetadata = () => void tryPlay();
  }

  async function cleanup() {
    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;

    try {
      pcCamRef.current?.close();
    } catch {}
    pcCamRef.current = null;

    screenStreamRef.current = null;
    camStreamRef.current = null;

    try {
      if (channelRef.current) await supabase.removeChannel(channelRef.current);
    } catch {}
    channelRef.current = null;

    try {
      if (channelCamRef.current) await supabase.removeChannel(channelCamRef.current);
    } catch {}
    channelCamRef.current = null;

    attachStream(null);

    if (waitHintTimerRef.current) {
      window.clearTimeout(waitHintTimerRef.current);
      waitHintTimerRef.current = null;
    }
    gotAnySignalRef.current = false;
    setConnectHint(null);

    setNeedsTapToPlay(false);
    setConnected(false);
    setStatus("idle");
    setRemoteQuality(null);

    activeSourceRef.current = "screen";
    setActiveSource("screen");
  }

  useEffect(() => {
    return () => {
      void cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshActiveSessions() {
    setActiveError(null);
    try {
      const r = await fetch("/api/sessions/active-for-helper");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setActiveSessions([]);
        setActiveError(j?.error ?? "Kan actieve sessies niet laden.");
        return;
      }
      setUseKoppelcode(Boolean(j?.use_koppelcode ?? true));
      setActiveSessions(Array.isArray(j?.sessions) ? j.sessions : []);
    } catch {
      setActiveSessions([]);
      setActiveError("Netwerkfout bij laden actieve sessies.");
    }
  }

  useEffect(() => {
    void refreshActiveSessions();
  }, []);

  async function connect(rawOverride?: string) {
    const raw = String(rawOverride ?? code).replace(/\D/g, "");
    if (raw.length !== 6) return alert("Vul 6 cijfers in.");

    await cleanup();
    setStatus("connecting");
    setConnectHint("Verbinden…");
    gotAnySignalRef.current = false;
    const attempt = ++connectAttemptRef.current;
    if (waitHintTimerRef.current) {
      window.clearTimeout(waitHintTimerRef.current);
      waitHintTimerRef.current = null;
    }
    waitHintTimerRef.current = window.setTimeout(() => {
      if (connectAttemptRef.current === attempt && !gotAnySignalRef.current) {
        setConnectHint("Wachten op ouder… (nog niet op schermdelen?)");
      }
    }, 6000);

    activeSourceRef.current = "screen";
    setActiveSource("screen");

    // ===== Signaling channels =====
    const ch = supabase.channel(`signal:${raw}`);
    channelRef.current = ch;

    const chCam = supabase.channel(`signalcam:${raw}`);
    channelCamRef.current = chCam;

    // ===== Peer connections =====
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    const pcCam = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcCamRef.current = pcCam;

    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (stream) {
        screenStreamRef.current = stream;
        if (activeSourceRef.current === "screen") attachStream(stream);
      }
    };

    pcCam.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (stream) {
        camStreamRef.current = stream;
        if (activeSourceRef.current === "camera") attachStream(stream);
      }
    };

    pc.onicecandidate = async (ev) => {
      if (!ev.candidate) return;
      await ch.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "ice", candidate: ev.candidate } satisfies SignalMsg,
      });
    };

    pcCam.onicecandidate = async (ev) => {
      if (!ev.candidate) return;
      await chCam.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "ice", candidate: ev.candidate } satisfies SignalMsg,
      });
    };

    ch.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;
      gotAnySignalRef.current = true;
      if (waitHintTimerRef.current) {
        window.clearTimeout(waitHintTimerRef.current);
        waitHintTimerRef.current = null;
      }
      setConnectHint(null);

      try {
        const pc0 = pcRef.current;
        if (!pc0) return;

        if (msg.type === "offer") {
          await pc0.setRemoteDescription(msg.sdp);
          const answer = await pc0.createAnswer();
          await pc0.setLocalDescription(answer);

          await ch.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "answer", sdp: answer } satisfies SignalMsg,
          });

          setStatus("connected");
          setConnected(true);
          setConnectHint(null);
          if (waitHintTimerRef.current) {
            window.clearTimeout(waitHintTimerRef.current);
            waitHintTimerRef.current = null;
          }

          if (screenStreamRef.current && activeSourceRef.current === "screen") {
            attachStream(screenStreamRef.current);
          }
          return;
        }

        if (msg.type === "ice") {
          if (msg.candidate) await pc0.addIceCandidate(msg.candidate);
          return;
        }

        if (msg.type === "quality") {
          setRemoteQuality(msg.quality);
          return;
        }

        if (msg.type === "active_source") {
          activeSourceRef.current = msg.source;
          setActiveSource(msg.source);
          if (msg.source === "screen") attachStream(screenStreamRef.current);
          else attachStream(camStreamRef.current);
          return;
        }

        if (msg.type === "draw_packet") {
          // bestaand: draw packets verwerken (laat jouw bestaande handler intact als je er 1 hebt)
          return;
        }
      } catch {
        setStatus("error");
        setConnectHint("Verbinding mislukt.");
        if (waitHintTimerRef.current) {
          window.clearTimeout(waitHintTimerRef.current);
          waitHintTimerRef.current = null;
        }
      }
    });

    chCam.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;
      gotAnySignalRef.current = true;
      if (waitHintTimerRef.current) {
        window.clearTimeout(waitHintTimerRef.current);
        waitHintTimerRef.current = null;
      }
      setConnectHint(null);

      try {
        const pc0 = pcCamRef.current;
        if (!pc0) return;

        if (msg.type === "offer") {
          await pc0.setRemoteDescription(msg.sdp);
          const answer = await pc0.createAnswer();
          await pc0.setLocalDescription(answer);

          await chCam.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "answer", sdp: answer } satisfies SignalMsg,
          });

          // camera kanaal: connected status laten we door "screen" kanaal bepalen
          return;
        }

        if (msg.type === "ice") {
          if (msg.candidate) await pc0.addIceCandidate(msg.candidate);
          return;
        }
      } catch {
        // camera kanaal errors niet hard falen
      }
    });

    const sub = await ch.subscribe();
    const sub2 = await chCam.subscribe();

    if (sub === "SUBSCRIBED") {
      await ch.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "hello", at: Date.now() } satisfies SignalMsg,
      });
    }
    if (sub2 === "SUBSCRIBED") {
      await chCam.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "hello", at: Date.now() } satisfies SignalMsg,
      });
    }
  }

  async function disconnect() {
    await cleanup();
  }

  // ====== (rest van jouw bestaande annotate/zoom/pan/etc blijft zoals hij was) ======

  return (
    <FullscreenShell
      sidebar={
        <div className="p-3 flex flex-col gap-3">
          <div className="text-sm font-semibold">Kind – verbinden</div>

          {/* Active sessions (als useKoppelcode uit staat) */}
          {!useKoppelcode ? (
            <div className="rounded-xl border bg-white p-3">
              <div className="text-sm font-semibold">Actieve sessies</div>
              <div className="text-xs text-slate-600 mt-1">
                Kies een sessie om direct mee te kijken.
              </div>

              {activeError ? (
                <div className="mt-2 text-xs text-red-700">{activeError}</div>
              ) : null}

              <div className="mt-2 text-xs text-slate-600">
                Status:{" "}
                <span className="font-semibold">
                  {status === "idle"
                    ? "Niet verbonden"
                    : status === "connecting"
                      ? "Verbinden…"
                      : status === "connected"
                        ? "Verbonden"
                        : "Fout"}
                </span>
                {connectHint ? (
                  <div className="mt-1 text-xs text-slate-500">{connectHint}</div>
                ) : null}
              </div>

              <div className="mt-3 flex flex-col gap-2">
                {activeSessions.length ? (
                  activeSessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => void connect(s.code)}
                      className="text-left rounded-xl border px-3 py-2 hover:bg-slate-50 disabled:opacity-60"
                      disabled={status === "connecting"}
                    >
                      <div className="text-xs text-slate-500">
                        {String(s.requester_name ?? "").trim() || "Ouder"}
                      </div>
                      <div className="font-semibold tracking-widest">
                        {formatCode(s.code)}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="text-xs text-slate-500">Geen actieve sessies.</div>
                )}
              </div>

              <div className="mt-3">
                <Button onClick={() => void refreshActiveSessions()} className="w-full">
                  Vernieuw
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border bg-white p-3">
              <div className="text-sm font-semibold">Sessiecode</div>
              <div className="text-xs text-slate-600 mt-1">
                Vul de 6-cijferige code in die je ouder/helper ziet.
              </div>

              <div className="mt-3 flex gap-2">
                <Input value={formatCode(code)} onChange={(e) => setCode(e.target.value)} placeholder="123 456" />
                <Button variant="primary" onClick={() => void connect()} disabled={status === "connecting"}>
                  Verbinden
                </Button>
              </div>

              <div className="mt-2 text-xs text-slate-600">
                Status:{" "}
                <span className="font-semibold">
                  {status === "idle"
                    ? "Niet verbonden"
                    : status === "connecting"
                      ? "Verbinden…"
                      : status === "connected"
                        ? "Verbonden"
                        : "Fout"}
                </span>
                {connectHint ? (
                  <div className="mt-1 text-xs text-slate-500">{connectHint}</div>
                ) : null}
              </div>
            </div>
          )}

          <div className="mt-auto">
            <Button onClick={() => void disconnect()} disabled={!connected} className="w-full">
              Verbreken
            </Button>
          </div>
        </div>
      }
    >
      <ViewerStage
        wrapRef={wrapRef}
        videoRef={videoRef}
        canvasRef={canvasRef}
        annotate={annotate}
        tool={tool}
        zoom={zoom}
        pan={pan}
        isFullscreen={isFullscreen}
        needsTapToPlay={needsTapToPlay}
        onTapToPlay={async () => {
          const v = videoRef.current;
          if (!v) return;
          try {
            await v.play();
            setNeedsTapToPlay(false);
          } catch {}
        }}
        onPointerDown={() => {}}
        onPointerMove={() => {}}
        onPointerUp={() => {}}
      />
    </FullscreenShell>
  );
}
