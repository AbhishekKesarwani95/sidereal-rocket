import { useEffect, useRef } from 'react';
import './VideoTile.css';

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
            // Bug 2 fix: attempt unmuted playback first.
            // If browser autoplay policy blocks audio, fall back to muted play
            // and add a one-time interaction handler to unmute.
            v.muted = isLocal || isMuted;
            v.play().catch(() => {
                // Autoplay was blocked — mute and retry
                v.muted = true;
                v.play().catch(() => { });
                if (!isLocal && !isMuted) {
                    // Unmute on first user interaction with this tile
                    const unlock = () => { v.muted = false; v.removeEventListener('click', unlock); };
                    v.addEventListener('click', unlock, { once: true });
                }
            });
        } else {
            v.srcObject = null;
        }
    }, [stream, isLocal, isMuted]);

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
        </div>
    );
}
