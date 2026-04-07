"use client";

import { useState } from "react";

interface VideoPlayerProps {
  connected: boolean;
  videoUid: string;
  cameraName?: string;
  cameraId?: string;
  /** LIVE GAME MODE: JPEG frame URL from Oracle WS (authoritative, synced with count/beep) */
  frameUrl?: string;
}

const CF_SUBDOMAIN = "customer-vn9syvcedwumw0ut.cloudflarestream.com";

// YouTube audio sources per camera (direct from YouTube, bypasses engine)
const YOUTUBE_AUDIO: Record<string, string> = {
  "bird-feeder-live": "QaGCkKIPAZU",
  "tokyo-shinjuku-crossing": "6dp-bvQ7RWo",
  "midway-airport-chicago": "67BCsiW-1Io",
  "peace-bridge": "DnUFAShZKus",
  "netherlands-highway": "Jy1Y9f8NEY0",
};

export default function VideoPlayer({
  connected,
  videoUid,
  cameraName = "LIVE CAMERA",
  cameraId,
  frameUrl,
}: VideoPlayerProps) {
  const [audioOn, setAudioOn] = useState(false);
  const isLiveMode = !!frameUrl;
  const youtubeId = cameraId ? YOUTUBE_AUDIO[cameraId] : null;

  const iframeSrc = !isLiveMode && videoUid
    ? `https://${CF_SUBDOMAIN}/${videoUid}/iframe?autoplay=true&muted=true&loop=true`
    : "";

  return (
    <div
      className="relative w-full"
      style={{
        aspectRatio: "16/9",
        background: "#000",
        borderRadius: "4px",
        overflow: "hidden",
        border: "1px solid #1a1a1a",
      }}
    >
      {isLiveMode ? (
        /* LIVE GAME MODE — same frame that generated the count */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frameUrl}
          alt="Live"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
      ) : iframeSrc ? (
        /* BROADCAST MODE — Cloudflare CDN, higher latency */
        <iframe
          src={iframeSrc}
          style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "#0a0a0a" }}>
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent mb-3"
            style={{ borderColor: "#00ff8855", borderTopColor: "transparent", animation: "spin 1s linear infinite" }} />
          <span className="text-sm font-black tracking-widest" style={{ color: "#00ff88", fontFamily: "monospace" }}>
            {connected ? "LOADING STREAM..." : "CONNECTING TO ORACLE..."}
          </span>
          <span className="text-xs mt-1" style={{ color: "#555", fontFamily: "monospace" }}>{cameraName}</span>
        </div>
      )}
      {/* YouTube audio (hidden iframe, direct from source — no engine) */}
      {audioOn && youtubeId && (
        <iframe
          src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=0&controls=0&modestbranding=1&rel=0&showinfo=0`}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
          allow="autoplay; encrypted-media"
        />
      )}
      {/* Audio toggle button */}
      {youtubeId && (
        <button
          onClick={() => setAudioOn(!audioOn)}
          style={{
            position: "absolute", top: 8, right: 20,
            background: audioOn ? "rgba(0,255,136,0.2)" : "rgba(0,0,0,0.6)",
            border: `1px solid ${audioOn ? "#00ff88" : "#555"}`,
            borderRadius: 4, padding: "3px 8px",
            fontSize: 11, fontFamily: "monospace", fontWeight: 900,
            color: audioOn ? "#00ff88" : "#888",
            cursor: "pointer",
          }}
        >
          {audioOn ? "🔊" : "🔇"}
        </button>
      )}
      {/* Connection indicator */}
      <div style={{
        position: "absolute", top: 8, right: 8, width: 8, height: 8, borderRadius: "50%",
        background: connected ? "#00ff88" : "#ff4444",
        boxShadow: connected ? "0 0 6px #00ff88" : "0 0 6px #ff4444",
      }} />
      {/* Mode badge */}
      {isLiveMode && (
        <div style={{
          position: "absolute", top: 6, left: 8,
          background: "rgba(0,0,0,0.6)", padding: "2px 6px", borderRadius: 4,
          fontSize: 9, fontFamily: "monospace", fontWeight: 900,
          color: "#00ff88", letterSpacing: "0.1em",
        }}>
          LIVE
        </div>
      )}
    </div>
  );
}
