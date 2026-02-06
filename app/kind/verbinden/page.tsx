"use client";

import type React from "react";
import { useMemo, useRef, useState, useEffect } from "react";
import { Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

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
  const activeSessionsRef = useRef<
    { id: string; code: string; requester_name?: string | null; created_at?: string }[]
  >([]);

  const [activeError, setActiveError] = useState<string | null>(null);

  // ✅ Ouder initieert altijd (scenario zonder extra 6-cijferige code)
  const [parentOnline, setParentOnline] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const currentSessionCodeRef = useRef<string | null>(null);

  const parentName = useMemo(() => {
    const n = (activeSessions?.[0]?.requester_name ?? "").trim();
    return n || "Ouder";
  }, [activeSessions]);

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

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [annotate, setAnnotate] = useState(false);
  const [tool, setTool] = useState<DrawTool>("circle");

  const [drawing, setDrawing] = useState<null | { startX: number; startY: number; currentX: number; currentY: number }>(
    null
  );
  const [shapes, setShapes] = useState<DraftShape[]>([]);
  const [needsTapToPlay, setNeedsTapToPlay] = useState(false);

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

    try {
      (v as any).srcObject = stream;
    } catch {}

    try {
      const p = v.play();
      if (p && typeof (p as any).catch === "function") {
        (p as any).catch(() => setNeedsTapToPlay(true));
      }
    } catch {}
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

    currentSessionCodeRef.current = null;

    activeSourceRef.current = "screen";
    setActiveSource("screen");
  }

  useEffect(() => {
      return (
    <div
      className="min-h-screen flex flex-col overflow-hidden bg-slate-100 text-slate-800"
      style={
        {
          ["--primary-dark" as any]: "#0a0b14",
          ["--sidebar-bg" as any]: "#0d0f1a",
          ["--background-light" as any]: "#f1f5f9",
          ["--accent-purple" as any]: "#6366f1",
        } as React.CSSProperties
      }
    >
      {/* Header */}
      <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[var(--accent-purple)] rounded-lg flex items-center justify-center shadow-sm">
            <span className="text-white text-sm font-black">K</span>
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight text-slate-900 leading-none">Kijk even Mee</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider leading-none">Kind dashboard</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-semibold border border-emerald-100">
            <span className="w-2 h-2 bg-emerald-500 rounded-full" />
            Systeem is gereed
          </div>

          <div className="flex items-center gap-3 pl-6 border-l border-slate-100">
            <div className="text-right">
              <p className="text-xs font-bold text-slate-900">Kind</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Gebruiker</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
              <span className="text-slate-500 text-sm">👤</span>
            </div>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 bg-[var(--sidebar-bg)] flex flex-col overflow-y-auto p-4 space-y-4">
          {/* Connect card */}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <h3 className="text-slate-900 font-bold text-xs mb-3">
              {useKoppelcode ? "Sessiecode" : "Contact - verbinden"}
            </h3>

            {useKoppelcode ? (
              <div className="space-y-3">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Vul de 6-cijferige code in die je ouder/helper ziet.
                </p>

                <div className="flex gap-2">
                  <Input
                    value={formatCode(code)}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123 456"
                    className="h-9 text-sm"
                  />
                  <Button
                    variant="primary"
                    className="h-9 px-3 text-[11px] font-bold"
                    onClick={() => void connect()}
                    disabled={status === "connecting"}
                  >
                    Verbinden
                  </Button>
                </div>

                <p className="text-[10px] text-slate-400 italic">
                  Status:{" "}
                  {status === "idle"
                    ? "Niet verbonden"
                    : status === "connecting"
                      ? "Verbinden…"
                      : status === "connected"
                        ? "Verbonden"
                        : "Fout"}
                </p>

                {connectHint ? <div className="text-[11px] text-slate-500">{connectHint}</div> : null}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Ouder start altijd de sessie. Jij kunt pas starten als er een sessie klaarstaat.
                </p>

                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${parentOnline ? "bg-emerald-500" : "bg-slate-300"}`} />
                  <span className="text-[11px] text-slate-600">
                    {parentOnline ? `${parentName} is online` : "Wachten tot ouder de sessie start"}
                  </span>
                </div>

                {sessionNotice ? <div className="text-[11px] text-slate-600">{sessionNotice}</div> : null}
                {activeError ? <div className="text-[11px] text-red-700">{activeError}</div> : null}

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="primary"
                    className="h-9 text-[11px] font-bold"
                    disabled={!canStartSession}
                    onClick={() => {
                      const first = activeSessions[0];
                      if (first) void connect(first.code);
                    }}
                  >
                    Start
                  </Button>

                  <Button
                    variant="secondary"
                    className="h-9 text-[11px] font-bold"
                    disabled={!canEndSession}
                    onClick={() => void disconnect()}
                  >
                    Stop
                  </Button>
                </div>

                <div className="text-[10px] text-slate-400 italic">
                  Status:{" "}
                  {status === "idle"
                    ? "Niet verbonden"
                    : status === "connecting"
                      ? "Verbinden…"
                      : status === "connected"
                        ? "Verbonden"
                        : "Fout"}
                </div>

                {/* duidelijke reden */}
                <div className="text-[10px] text-slate-400">
                  {!parentOnline && "Wachten tot ouder een sessie start…"}
                  {parentOnline && !activeSessions.length && "Geen actieve sessies gevonden."}
                  {status === "connecting" && `Bezig met verbinden met ${parentName}…`}
                  {connected && "Je bent verbonden."}
                </div>

                {connectHint ? <div className="text-[11px] text-slate-500">{connectHint}</div> : null}
              </div>
            )}
          </div>

          {/* Instructions / annotations */}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <h3 className="text-slate-900 font-bold text-[10px] uppercase tracking-wider mb-3 text-slate-400">
              Instructies
            </h3>

            <Button
              className="w-full h-9 mb-3 text-xs font-bold flex items-center justify-center gap-2"
              variant="secondary"
              onClick={() => setAnnotate((v) => !v)}
            >
              ✏️ {annotate ? "Tekenen aan" : "Tekenen uit"}
            </Button>

            <div className="grid grid-cols-3 gap-1 mb-3">
              <Button
                className="h-9 text-[11px] font-bold"
                variant={tool === "circle" ? "primary" : "secondary"}
                onClick={() => setTool("circle")}
              >
                Cirkel
              </Button>
              <Button
                className="h-9 text-[11px] font-bold"
                variant={tool === "rect" ? "primary" : "secondary"}
                onClick={() => setTool("rect")}
              >
                Rechthoek
              </Button>
              <Button
                className="h-9 text-[11px] font-bold"
                variant={tool === "arrow" ? "primary" : "secondary"}
                onClick={() => setTool("arrow")}
              >
                Pijl
              </Button>
            </div>

            <div className="space-y-2">
              <Button className="w-full h-9 text-xs" variant="secondary" onClick={() => clear()} disabled={!shapes.length}>
                Wis
              </Button>

              <Button
                className="w-full h-9 text-xs font-bold"
                variant="secondary"
                onClick={() => void sendDrawPacket()}
                disabled={!shapes.length || !connected}
              >
                📸 Snapshot sturen
              </Button>
            </div>
          </div>

          {/* Zoom */}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <h3 className="text-slate-900 font-bold text-[10px] uppercase tracking-wider mb-3 text-slate-400">
              Zoom controls
            </h3>

            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1 flex-1">
                <Button className="flex-1 h-9" variant="secondary" onClick={() => zoomOut()}>
                  −
                </Button>
                <Button className="flex-1 h-9" variant="secondary" onClick={() => zoomIn()}>
                  +
                </Button>
              </div>

              <Button className="px-3 h-9 text-xs font-bold" variant="secondary" onClick={() => resetView()}>
                Reset
              </Button>
            </div>
          </div>

          {/* Fullscreen */}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <Button
              className="w-full h-10 text-xs font-bold flex items-center justify-center gap-2"
              variant="secondary"
              onClick={() => setIsFullscreen(true)}
            >
              ⛶ Fullscreen
            </Button>
          </div>

          {/* Remote quality indicator (blijft bestaan) */}
          {remoteQuality ? (
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-2">Kwaliteit</div>
              <div className="text-xs text-slate-700">
                Ouder staat op: <span className="font-bold">{remoteQuality.toUpperCase()}</span>
              </div>
            </div>
          ) : null}
        </aside>

        {/* Main */}
        <main className="flex-1 bg-black flex flex-col relative overflow-hidden">
          {/* Active source badge */}
          <div className="absolute top-6 right-6 z-10">
            <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
              <p className="text-white text-[10px] font-medium tracking-wide">
                BRON:{" "}
                <span className="font-bold">
                  {activeSource === "camera" ? "TELEFOON CAMERA" : "PC SCHERM"}
                </span>
              </p>
            </div>
          </div>

          <ViewerStage>
            {/* Waiting / empty state */}
            {status !== "connected" ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
                <div className="max-w-md">
                  <div className="w-20 h-20 bg-slate-900/50 rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <span className="text-slate-700 text-3xl">🖥️</span>
                  </div>
                  <h3 className="text-slate-400 text-xl font-medium">Wachten op gedeeld scherm…</h3>
                  <p className="text-slate-600 text-sm mt-3 leading-relaxed">
                    Zodra de ouder de verbinding accepteert en het scherm deelt, verschijnt de weergave hier.
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-full w-full flex items-center justify-center bg-black">
                <div
                  ref={wrapRef}
                  className="relative w-full h-full overflow-hidden"
                  onWheel={onWheel}
                  onPointerDown={onPointerDownPan}
                  onPointerMove={onPointerMovePan}
                  onPointerUp={onPointerUpPan}
                  onPointerCancel={onPointerUpPan}
                  style={{ touchAction: annotate ? "none" : "pan-x pan-y" }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      transformOrigin: "center center",
                    }}
                  >
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
                  </div>

                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0"
                    style={{ pointerEvents: annotate ? "auto" : "none" }}
                    onPointerDown={onCanvasPointerDown}
                    onPointerMove={onCanvasPointerMove}
                    onPointerUp={onCanvasPointerUp}
                    onPointerCancel={onCanvasPointerUp}
                    onPointerLeave={onCanvasPointerUp}
                  />

                  {needsTapToPlay ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="rounded-2xl bg-black/70 border border-white/15 text-white px-4 py-3 text-sm">
                        <div className="font-semibold mb-1">Klik om beeld te starten</div>
                        <div className="text-white/70 mb-3">
                          Je browser blokkeert autoplay. Klik hieronder om de stream te starten.
                        </div>
                        <Button variant="primary" onClick={tapToPlay}>
                          Start beeld
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {isFullscreen ? (
                    <div className="absolute top-3 left-3 rounded-xl bg-black/60 text-white text-sm px-3 py-2 z-10">
                      Fullscreen — druk <b>ESC</b> om terug te gaan
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </ViewerStage>

          {/* Bottom connection status */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 px-6 py-2 rounded-full flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-600"}`} />
                <span className="text-[10px] font-bold text-slate-200 uppercase tracking-widest">
                  Verbinding: {connected ? "Actief" : "Inactief"}
                </span>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
