"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Card, Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Quality = "low" | "medium" | "high";

type SignalMsg =
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any }
  | { type: "quality"; quality: Quality };

function formatCode(v: string) {
  const digits = v.replace(/\D/g, "").slice(0, 6);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function KindVerbinden() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [code, setCode] = useState("");

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");

  const [remoteQuality, setRemoteQuality] = useState<Quality | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);

  // Zoom + pan state
  const [zoom, setZoom] = useState(1); // 1.0x - 3.0x
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  });

  const [isFullscreen, setIsFullscreen] = useState(false);

  // ---- Hard cap pan helpers ----
  function clampPan(nextPan: { x: number; y: number }, nextZoom = zoom) {
    const vp = viewportRef.current;
    const vid = videoRef.current;
    if (!vp || !vid) return nextPan;

    // viewport grootte
    const vpW = vp.clientWidth || 0;
    const vpH = vp.clientHeight || 0;

    // video element grootte (in layout, bij zoom=1)
    const baseW = vid.clientWidth || 0;
    const baseH = vid.clientHeight || 0;

    if (!vpW || !vpH || !baseW || !baseH) return nextPan;

    const scaledW = baseW * nextZoom;
    const scaledH = baseH * nextZoom;

    // Als scaled kleiner is dan viewport: center-ish, maar hier klemmen we naar 0
    // We willen voorkomen dat je uit beeld sleept:
    const minX = Math.min(0, vpW - scaledW);
    const minY = Math.min(0, vpH - scaledH);

    return {
      x: clamp(nextPan.x, minX, 0),
      y: clamp(nextPan.y, minY, 0),
    };
  }

  // Bij zoom wijziging: pan opnieuw klemmen
  useEffect(() => {
    setPan((p) => clampPan(p, zoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // Fullscreen detect (ESC tip)
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ---- Cleanup (fix reconnect-bug) ----
  async function cleanup() {
    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;

    try {
      if (channelRef.current) {
        // removeChannel is async in supabase v2
        await supabase.removeChannel(channelRef.current);
      }
    } catch {}
    channelRef.current = null;

    // Video stream weggooien (belangrijk bij reconnect)
    if (videoRef.current) {
      try {
        (videoRef.current as any).srcObject = null;
      } catch {}
    }

    setConnected(false);
    setStatus("idle");
    setRemoteQuality(null);
  }

  useEffect(() => {
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    const raw = code.replace(/\D/g, "");
    if (raw.length !== 6) return alert("Vul 6 cijfers in.");

    // Belangrijk: eerst echt opruimen (fix: daarna direct opnieuw verbinden zonder code wijziging)
    await cleanup();

    setStatus("connecting");

    const ch = supabase.channel(`signal:${raw}`);
    channelRef.current = ch;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play?.().catch(() => {});
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        ch.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "ice", candidate: e.candidate } satisfies SignalMsg,
        });
      }
    };

    ch.on("broadcast", { event: "signal" }, async (payload: any) => {
      const msg = payload.payload as SignalMsg;

      try {
        if (!pcRef.current) return;

        if (msg.type === "offer") {
          await pcRef.current.setRemoteDescription(msg.sdp);
          const answer = await pcRef.current.createAnswer();
          await pcRef.current.setLocalDescription(answer);
          await ch.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "answer", sdp: answer } satisfies SignalMsg,
          });

          setStatus("connected");
          setConnected(true);
        } else if (msg.type === "ice") {
          await pcRef.current.addIceCandidate(msg.candidate);
        } else if (msg.type === "quality") {
          setRemoteQuality(msg.quality);
        }
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    }).subscribe();
  }

  async function disconnect() {
    await cleanup();
  }

  // Zoom helpers
  function zoomOut() {
    setZoom((z) => {
      const next = Math.max(1, +(z - 0.25).toFixed(2));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }
  function zoomIn() {
    setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)));
  }

  function resetView() {
    // ✅ Reset moet naar 100% (niet 0%) + pan naar 0
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  async function fullscreen() {
    try {
      const el = videoRef.current;
      if (!el) return;
      await (el as any).requestFullscreen?.();
    } catch {}
  }

  // Pan/drag handlers (alleen als zoom > 1)
  function onPointerDown(e: React.PointerEvent) {
    if (zoom <= 1) return;
    (e.currentTarget as any).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      baseX: pan.x,
      baseY: pan.y,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current.dragging) return;

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    const next = { x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy };
    setPan(clampPan(next));
  }

  function onPointerUp() {
    dragRef.current.dragging = false;
  }

  const raw = code.replace(/\D/g, "");
  const canConnect = raw.length === 6; // ✅ niet afhankelijk van status; connect button blijft logisch

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Meekijken</h1>
        <p className="text-slate-600">Vul de code in die je ouder ziet.</p>
      </header>

      <Card className="space-y-4">
        <Input
          value={code}
          onChange={(e) => setCode(formatCode(e.target.value))}
          placeholder="123 456"
          inputMode="numeric"
          autoFocus
        />

        {!connected ? (
          <Button variant="primary" className="w-full" onClick={connect} disabled={!canConnect || status === "connecting"}>
            {status === "connecting" ? "Verbinden…" : "Verbind"}
          </Button>
        ) : (
          <Button className="w-full" onClick={disconnect}>
            Stop meekijken
          </Button>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="text-sm text-slate-600">
            Status: <span className="font-mono">{status}</span>
            {remoteQuality ? (
              <>
                {" "}• Kwaliteit: <span className="font-mono">{remoteQuality}</span>
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={zoomOut} disabled={zoom <= 1} title="Zoom uit">
              −
            </Button>

            <input
              type="range"
              min={1}
              max={3}
              step={0.25}
              value={zoom}
              onChange={(e) => {
                const v = Number(e.target.value);
                setZoom(v);
                if (v === 1) setPan({ x: 0, y: 0 });
              }}
            />

            <Button onClick={zoomIn} disabled={zoom >= 3} title="Zoom in">
              +
            </Button>

            <div className="text-sm text-slate-600 w-14 text-right">{Math.round(zoom * 100)}%</div>

            <Button onClick={resetView}>Reset</Button>

            <Button onClick={fullscreen}>Fullscreen</Button>
          </div>
        </div>

        {isFullscreen ? (
          <div className="mb-3 text-sm text-slate-600">
            Fullscreen actief — druk <b>ESC</b> om terug te gaan.
          </div>
        ) : null}

        <div
          ref={viewportRef}
          className="rounded-xl bg-black/90 overflow-hidden"
          style={{
            width: "100%",
            touchAction: "none",
            cursor: zoom > 1 ? (dragRef.current.dragging ? "grabbing" : "grab") : "default",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "top left",
              width: "100%",
            }}
          >
            <video ref={videoRef} autoPlay playsInline className="w-full rounded-xl" />
          </div>
        </div>

        {zoom > 1 ? (
          <p className="mt-3 text-sm text-slate-600">
            Tip: sleep het beeld om te verplaatsen. Je raakt niet meer “kwijt” buiten beeld.
          </p>
        ) : null}
      </Card>
    </main>
  );
}
