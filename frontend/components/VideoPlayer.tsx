/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface VideoPlayerProps {
  connected: boolean;
  videoUid: string;
  cameraName?: string;
  cameraId?: string;
  frameUrl?: string;
  frameRef?: React.RefObject<HTMLImageElement>;
}

const CF_SUBDOMAIN = "customer-vn9syvcedwumw0ut.cloudflarestream.com";

const YOUTUBE_AUDIO: Record<string, string> = {
  "bird-feeder-live": "QaGCkKIPAZU",
  "tokyo-shinjuku-crossing": "6dp-bvQ7RWo",
  "midway-airport-chicago": "67BCsiW-1Io",
  "peace-bridge": "DnUFAShZKus",
  "netherlands-highway": "Jy1Y9f8NEY0",
};

// Load YouTube IFrame API once
let ytApiLoaded = false;
function loadYTApi(): Promise<void> {
  if (ytApiLoaded || (window as any).YT?.Player) {
    ytApiLoaded = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    (window as any).onYouTubeIframeAPIReady = () => {
      ytApiLoaded = true;
      resolve();
    };
  });
}

export default function VideoPlayer({
  connected,
  videoUid,
  cameraName = "LIVE CAMERA",
  cameraId,
  frameRef,
}: VideoPlayerProps) {
  const [audioOn, setAudioOn] = useState(false);
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Live mode = connected + frameRef provided (frames written directly by hook)
  const isLiveMode = connected && !!frameRef;
  const youtubeId = cameraId ? YOUTUBE_AUDIO[cameraId] : null;

  const toggleAudio = useCallback(async () => {
    if (audioOn) {
      // Turn off
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      setAudioOn(false);
    } else if (youtubeId) {
      // Turn on — create player on user click (satisfies autoplay policy)
      await loadYTApi();
      const YT = (window as any).YT;
      // Create a tiny container for the player
      let el = document.getElementById("yt-audio-player");
      if (!el) {
        el = document.createElement("div");
        el.id = "yt-audio-player";
        el.style.cssText = "position:absolute;bottom:4px;left:4px;width:72px;height:40px;overflow:hidden;border-radius:4px;opacity:0.3;z-index:5;";
        containerRef.current?.appendChild(el);
      }
      playerRef.current = new YT.Player("yt-audio-player", {
        height: "40",
        width: "72",
        videoId: youtubeId,
        playerVars: { autoplay: 1, controls: 0, modestbranding: 1, rel: 0, showinfo: 0 },
        events: {
          onReady: (e: any) => {
            e.target.unMute();
            e.target.setVolume(80);
            e.target.playVideo();
          },
        },
      });
      setAudioOn(true);
    }
  }, [audioOn, youtubeId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
    };
  }, []);

  const iframeSrc = !isLiveMode && videoUid
    ? `https://${CF_SUBDOMAIN}/${videoUid}/iframe?autoplay=true&muted=true&loop=true`
    : "";

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{
        aspectRatio: "16/9",
        background: "#000",
        borderRadius: "4px",
        overflow: "hidden",
        border: "1px solid #1a1a1a",
      }}
    >
      {/* Live JPEG frame — written directly by useOracleState via ref, no React re-render */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={frameRef}
        alt="Live"
        style={{
          width: "100%", height: "100%", objectFit: "contain",
          display: isLiveMode ? "block" : "none",
        }}
      />
      {!isLiveMode && iframeSrc ? (
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
      {/* Audio toggle */}
      {youtubeId && (
        <button
          onClick={toggleAudio}
          style={{
            position: "absolute", top: 8, right: 20,
            background: audioOn ? "rgba(0,255,136,0.2)" : "rgba(0,0,0,0.6)",
            border: `1px solid ${audioOn ? "#00ff88" : "#555"}`,
            borderRadius: 4, padding: "3px 8px",
            fontSize: 11, fontFamily: "monospace", fontWeight: 900,
            color: audioOn ? "#00ff88" : "#888",
            cursor: "pointer",
            zIndex: 10,
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
