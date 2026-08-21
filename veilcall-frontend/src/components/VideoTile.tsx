import { useEffect, useRef } from 'react';

interface VideoTileProps {
    stream: MediaStream | null;
    label: string;
    isLocal?: boolean;
    isMuted?: boolean;
    isVideoOff?: boolean;
    blurOn?: boolean;
    isSmall?: boolean;
    onClick?: () => void;
}

export default function VideoTile({
    stream, label, isLocal = false, isMuted = false, isVideoOff = false,
    blurOn = true, isSmall = false, onClick,
}: VideoTileProps) {
    const videoRef = useRef<HTMLVideoElement>(null);

    // Always render the <video> element — just hide/show via CSS.
    // If we conditionally render it, the ref is null when srcObject is set.
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        if (stream) {
            v.srcObject = stream;
            v.play().catch(() => { });
        } else {
            v.srcObject = null;
        }
    }, [stream]);

    const showVideo = !!stream && !isVideoOff;

    return (
        <div
            className={`video-tile ${isSmall ? 'video-tile-small' : ''} ${onClick ? 'video-tile-clickable' : ''}`}
            onClick={onClick}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={onClick ? e => e.key === 'Enter' && onClick() : undefined}
            aria-label={`${label} video tile`}
        >
            {/* Avatar shown when no stream or video is off */}
            {!showVideo && (
                <div className="tile-avatar">
                    <div className="avatar-circle">
                        {label.charAt(0).toUpperCase()}
                    </div>
                    {!stream && (
                        <div className="tile-waiting">Connecting…</div>
                    )}
                </div>
            )}

            {/* Video element: always in DOM so ref is never null when srcObject is assigned */}
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isLocal || isMuted}
                className="tile-video"
                aria-label={`${label} video`}
                style={{ display: showVideo ? 'block' : 'none' }}
            />

            {/* Overlays */}
            <div className="tile-overlays">
                <div className="tile-label">{label}{isLocal ? ' (You)' : ''}</div>
                <div className="tile-badges">
                    {isMuted && <span className="tile-badge tile-badge-mute" title="Muted">🔇</span>}
                    {isVideoOff && <span className="tile-badge" title="Camera off">📷</span>}
                    <span
                        className={`tile-badge ${blurOn ? 'blur-on-badge' : 'blur-off-badge'}`}
                        title={blurOn ? 'Blur is ON' : 'Blur is OFF — face visible'}
                    >
                        {blurOn ? '🛡️' : '⚠️'}
                    </span>
                </div>
            </div>

            <style>{`
        .video-tile {
          position: relative;
          background: #0a1120;
          border-radius: var(--rad-xl);
          overflow: hidden;
          aspect-ratio: 16/9;
          border: 1px solid var(--clr-border);
          transition: border-color var(--tr-base), box-shadow var(--tr-base);
        }
        .video-tile-clickable { cursor: pointer; }
        .video-tile-clickable:hover { border-color: var(--clr-primary); box-shadow: var(--shadow-primary); }
        .video-tile-small { border-radius: var(--rad-lg); border-color: var(--clr-primary); box-shadow: var(--shadow-primary); }
        .tile-video { width: 100%; height: 100%; object-fit: cover; }
        .tile-avatar { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: linear-gradient(135deg, #0d1a2d, #1a2540); }
        .avatar-circle {
          width: clamp(48px, 10%, 80px);
          aspect-ratio: 1;
          border-radius: 50%;
          background: var(--grad-primary);
          display: flex; align-items: center; justify-content: center;
          font-size: clamp(1.2rem, 3vw, 2rem);
          font-weight: 700;
          font-family: var(--font-head);
          color: #fff;
        }
        .tile-waiting { font-size: 0.75rem; color: var(--clr-text-3); font-family: var(--font-head); animation: pulse-ring 2s infinite; }
        .tile-overlays {
          position: absolute; inset: 0;
          display: flex; flex-direction: column;
          justify-content: space-between;
          padding: var(--sp-3);
          background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 40%);
          pointer-events: none;
        }
        .tile-badges { display: flex; gap: var(--sp-1); align-self: flex-end; }
        .tile-badge {
          font-size: 0.9rem;
          background: rgba(0,0,0,0.6);
          border-radius: var(--rad-full);
          padding: 3px 6px;
          backdrop-filter: blur(4px);
        }
        .blur-on-badge { background: rgba(16,185,129,0.3); }
        .blur-off-badge { background: rgba(239,68,68,0.4); animation: pulse-ring 2s infinite; }
        .tile-label {
          align-self: flex-start;
          background: rgba(0,0,0,0.5);
          padding: 3px 10px;
          border-radius: var(--rad-full);
          font-size: 0.75rem;
          font-weight: 600;
          font-family: var(--font-head);
          backdrop-filter: blur(4px);
        }
      `}</style>
        </div>
    );
}
