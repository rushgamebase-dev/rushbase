"use client";

interface VideoPlayerProps {
  connected: boolean;
  videoUid: string;
  cameraName?: string;
  /** LIVE GAME MODE: JPEG frame URL from Oracle WS (authoritative, synced with count/beep) */
  frameUrl?: string;
}

const CF_SUBDOMAIN = "customer-vn9syvcedwumw0ut.cloudflarestream.com";

export default function VideoPlayer({
  connected,
  videoUid,
  cameraName = "LIVE CAMERA",
  frameUrl,
}: VideoPlayerProps) {
  // LIVE MODE: direct JPEG frames from YOLO worker via WS
  // BROADCAST MODE: Cloudflare Stream iframe (fallback)
  const isLiveMode = !!frameUrl;

  const iframeSrc = !isLiveMode && videoUid
    ? `https://${CF_SUBDOMAIN}/${videoUid}/iframe?autoplay=true&muted=false&loop=true`
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
