"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Card, Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

type SignalMsg =
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any };

function formatCode(v: string) {
  const digits = v.replace(/\D/g, "").slice(0, 6);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

export default function KindVerbinden() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [code, setCode] = useState("");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");

  const videoRef = useRef<HTMLVideoElement | null>(null);
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

  // Helper: cleanup alles netjes
  function cleanup() {
    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;

    if (channelRef.current) {
      try {
        supabase.removeChannel(channelRef.current);
      } catch {}
    }
    channelRef.current = null;

    setConnected(false);
    setStatus("idle");
  }

  useEffect(() => {
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    const raw = code.replace(/\D/g, "");
    if (raw.length !== 6) return alert("Vul 6 cijfers in.");

    // als je opnieuw verbindt: eerst opruimen
    cleanup();

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
        // soms moet je expliciet play() aanroepen
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
        }
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    }).subscribe();
  }

  function disconnect() {
    cleanup();
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

  // Fullscreen helper
  async function fullscreen() {
    try {
      const el = videoRef.current;
      if (!el) return;
      // fullscreen op video element werkt in de meeste browsers
      await (el as any).requestFullscreen?.();
    } catch {
      // ignore
    }
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

    // Pan voelt natuurlijker als je ingezoomd bent:
    setPan({
      x: dragRef.current.baseX + dx,
      y: dragRef.current.baseY + dy,
    });
  }

  function onPointerUp() {
    dragRef.current.dragging = false;
  }

  const raw = code.replace(/\D/g, "");
  const canConnect = raw.length === 6 && status !== "connecting";

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
          <Button variant="primary" className="w-full" onClick={connect} disabled={!canConnect}>
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
          </div>

          <div className="flex items-center gap-2">
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

            <Button onClick={() => setPan({ x: 0, y: 0 })} disabled={zoom <= 1}>
              Reset
            </Button>

            <Button onClick={fullscreen}>Fullscreen</Button>
          </div>
        </div>

        <div
          className="rounded-xl bg-black/90 overflow-hidden"
          style={{
            // vaste "viewport" waarbinnen je kunt pannen
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
            Tip: sleep het beeld om te verplaatsen. (Zoom = {Math.round(zoom * 100)}%)
          </p>
        ) : null}
      </Card>
    </main>
  );
}
