import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import VideoTile from '../components/VideoTile';
import EmojiReactions, { type ReactionEvent } from '../components/EmojiReactions';
import { useFaceBlur, DEFAULT_BLUR_OPTIONS, type BlurMode, type BlurOptions } from '../hooks/useFaceBlur';
import { useWebRTC } from '../hooks/useWebRTC';
import { useNetworkTier, TIER_LABEL } from '../hooks/useNetworkTier';
import { useScreenRecordingGuard } from '../hooks/useScreenRecordingGuard';
import { useBackCameraMonitor } from '../hooks/useBackCameraMonitor';
import './Room.css';

interface ChatMessage {
    id: string;
    from: string;
    text: string;
    ts: number;
    own: boolean;
    replyTo?: { from: string; text: string };
}

function formatTime(ts: number) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Room() {
    const { code } = useParams<{ code: string }>();
    const navigate = useNavigate();

    const [blurOptions, setBlurOptions] = useState<BlurOptions>(DEFAULT_BLUR_OPTIONS);
    const [micMuted, setMicMuted] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [expandedPeer, setExpandedPeer] = useState<string | null>(null);
    const [roomError, setRoomError] = useState<string | null>(null);
    const [blurPanelOpen, setBlurPanelOpen] = useState(false);
    const [micStream, setMicStream] = useState<MediaStream | null>(null);
    // Bug 2 fix: use a stable MediaStream object; mutate tracks in-place so
    // useWebRTC's replaceTrack/addTrack always operates on the same reference.
    const stableLocalStream = useRef<MediaStream>(new MediaStream());
    const [localStream, setLocalStream] = useState<MediaStream>(stableLocalStream.current);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const chatInputRef = useRef<HTMLInputElement>(null);
    const [replyingTo, setReplyingTo] = useState<{ from: string; text: string } | null>(null);

    // ── Feature state ──────────────────────────────────────────────────────────
    const [reactions, setReactions] = useState<ReactionEvent[]>([]);
    const [pttMode, setPttMode] = useState(false);          // Push-to-Talk mode toggle
    const pttActiveRef = useRef(false);                     // Space bar currently held
    const [callEnded, setCallEnded] = useState(false);      // All peers left
    const hadPeersRef = useRef(false);                      // Track if we ever had peers
    const [waitingPeers, setWaitingPeers] = useState<string[]>([]); // Host: pending joiners
    const [isWaitingOverlay, setIsWaitingOverlay] = useState(false); // Joiner: waiting room

    const roomCode = code ?? '';

    const networkTier = useNetworkTier();

    // ── Screen recording detection ─────────────────────────────────────────
    const { recordingDetected, source: recordingSource } = useScreenRecordingGuard();
    const [recordingToastDismissed, setRecordingToastDismissed] = useState(false);
    // Show toast again every time a new detection event fires
    useEffect(() => {
        if (recordingDetected) setRecordingToastDismissed(false);
    }, [recordingDetected]);

    const { videoRef, canvasRef, blurredStreamState, start, stop, pauseCamera, resumeCamera, cameraEnabled, switchCamera, activeFacingMode } = useFaceBlur(blurOptions, networkTier, recordingDetected);

    // ── Back camera threat monitor ───────────────────────────────────
    const backCam = useBackCameraMonitor();
    const [threatToastDismissed, setThreatToastDismissed] = useState(false);
    useEffect(() => { if (backCam.threatDetected) setThreatToastDismissed(false); }, [backCam.threatDetected]);


    // ── Must be defined BEFORE useWebRTC to satisfy Rules of Hooks ───────────
    const handleChatMessage = useCallback((from: string, text: string, ts: number, replyTo?: { from: string; text: string }) => {
        setMessages(prev => [
            ...prev,
            { id: `${ts}-${from}`, from: from.slice(0, 8), text, ts, own: false, replyTo },
        ]);
    }, []);

    const handleReaction = useCallback((from: string, emoji: string) => {
        const event: ReactionEvent = { id: `${Date.now()}-${from}`, from, emoji, ts: Date.now() };
        setReactions(prev => [...prev, event]);
        // Auto-remove after 3.5s
        setTimeout(() => setReactions(prev => prev.filter(r => r.id !== event.id)), 3500);
    }, []);

    const { peers, connected, connect, disconnect, sendChatMessage, sendReaction,
        shareScreen, isScreenSharing, approvePeer, rejectPeer, isWaiting, refreshTracks } = useWebRTC({
            roomCode,
            localStream,
            networkTier,
            onError: setRoomError,
            onChatMessage: handleChatMessage,
            onReaction: handleReaction,
            onPeerWaiting: (peerId) => setWaitingPeers(prev => [...prev, peerId]),
            onWaitingForApproval: () => setIsWaitingOverlay(true),
        });

    // Bug 2 fix: mutate the stable stream in-place instead of creating a new object.
    // Placed AFTER useWebRTC so that refreshTracks is in scope.
    // This keeps the same MediaStream reference alive so WebRTC senders replaceTrack reliably.
    useEffect(() => {
        const s = stableLocalStream.current;
        s.getVideoTracks().forEach(t => s.removeTrack(t));
        blurredStreamState?.getVideoTracks().forEach(t => s.addTrack(t));
        s.getAudioTracks().forEach(t => s.removeTrack(t));
        micStream?.getAudioTracks().forEach(t => s.addTrack(t));
        setLocalStream(s);
        // Push updated tracks to any already-open PCs (same stream ref won't re-trigger
        // the localStream effect in useWebRTC naturally)
        refreshTracks();
    }, [blurredStreamState, micStream]); // eslint-disable-line

    // ── Connect immediately on mount ─────────────────────────────────────────
    // (connect() is now deferred below until micStream is ready — see Bug 6 fix)

    // ── Start camera (non-blocking) ──────────────────────────────────────────
    useEffect(() => { start(); return () => stop(); }, []); // eslint-disable-line

    // ── Feature 4: detect when all peers have left ────────────────────────────
    useEffect(() => {
        if (peers.size > 0) hadPeersRef.current = true;
        if (hadPeersRef.current && peers.size === 0 && connected) setCallEnded(true);
    }, [peers.size, connected]); // eslint-disable-line

    // ── Feature 5: sync isWaiting from hook ──────────────────────────────────
    useEffect(() => { setIsWaitingOverlay(isWaiting); }, [isWaiting]);

    // ── Feature 3: Push-to-Talk spacebar handler ──────────────────────────────
    useEffect(() => {
        if (!pttMode) return;
        const onDown = (e: KeyboardEvent) => {
            if (e.code !== 'Space' || e.repeat || pttActiveRef.current) return;
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
            pttActiveRef.current = true;
            // Unmute mic while holding space
            micStream?.getAudioTracks().forEach(t => { t.enabled = true; });
        };
        const onUp = (e: KeyboardEvent) => {
            if (e.code !== 'Space') return;
            pttActiveRef.current = false;
            // Re-mute on release
            micStream?.getAudioTracks().forEach(t => { t.enabled = false; });
        };
        document.addEventListener('keydown', onDown);
        document.addEventListener('keyup', onUp);
        // Mute mic when entering PTT mode
        micStream?.getAudioTracks().forEach(t => { t.enabled = false; });
        return () => {
            document.removeEventListener('keydown', onDown);
            document.removeEventListener('keyup', onUp);
            // Restore mic when exiting PTT mode
            micStream?.getAudioTracks().forEach(t => { t.enabled = !micMuted; });
        };
    }, [pttMode, micStream, micMuted]); // eslint-disable-line

    // ── Start back camera monitor once connected ──────────────────────────────
    useEffect(() => {
        if (connected && backCam.supported !== false) {
            backCam.start();
        }
        return () => backCam.stop();
    }, [connected]); // eslint-disable-line

    // ── Start mic (independent) ──────────────────────────────────────────────
    const micReadyRef = useRef(false);
    useEffect(() => {
        let ref: MediaStream | null = null;
        // navigator.mediaDevices is undefined on plain HTTP on mobile — guard required
        if (!navigator.mediaDevices?.getUserMedia) {
            micReadyRef.current = true; // mic unavailable — don't block connect
            return;
        }
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
            .then(s => { ref = s; micReadyRef.current = true; setMicStream(s); })
            .catch(() => { micReadyRef.current = true; }); // permission denied — don't block connect
        return () => { ref?.getTracks().forEach(t => t.stop()); };
    }, []); // eslint-disable-line

    // ── Connect: wait for BOTH mic AND blurred camera stream before connecting ──
    // Bug 3 fix: ensures tracks exist in localStream before the first offer is sent.
    // Without this, connect() fires before the canvas captureStream is ready →
    // no senders exist → no offer → one or both sides never get video.
    const blurStreamReadyRef = useRef(false);
    useEffect(() => {
        if (blurredStreamState) blurStreamReadyRef.current = true;
    }, [blurredStreamState]);

    const didConnect = useRef(false);
    useEffect(() => {
        if (!roomCode || didConnect.current) return;
        const tryConnect = () => {
            if (didConnect.current) return;
            didConnect.current = true;
            connect();
        };
        // Fast path: both streams already ready
        if (micReadyRef.current && blurStreamReadyRef.current) { tryConnect(); return; }
        // Otherwise wait — max 4 s so a camera denial doesn't block forever
        const timer = setTimeout(tryConnect, 4000);
        return () => clearTimeout(timer);
    }, [roomCode, micStream, blurredStreamState]); // eslint-disable-line

    // ── Cleanup on unmount ───────────────────────────────────────────────────
    useEffect(() => () => disconnect(), []); // eslint-disable-line

    // ── Mic mute/unmute — toggle enabled on the SAME track object used by localStream ──
    const toggleMic = useCallback(() => {
        setMicMuted(prev => {
            const nextMuted = !prev;
            micStream?.getAudioTracks().forEach(t => { t.enabled = !nextMuted; });
            return nextMuted;
        });
    }, [micStream]);

    // ── Camera — use pause/resume from hook (stops LED + blacks canvas) ───────
    const toggleCamera = useCallback(() => {
        if (cameraEnabled) pauseCamera();
        else resumeCamera();
    }, [cameraEnabled, pauseCamera, resumeCamera]);

    // ── Chat scroll ──────────────────────────────────────────────────────────
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // ── Handlers ─────────────────────────────────────────────────────────────
    const handleSendChat = (e: React.FormEvent) => {
        e.preventDefault();
        const text = chatInput.trim();
        if (!text || !connected) return;
        const ts = Date.now();
        sendChatMessage(text);
        setMessages(prev => [
            ...prev,
            { id: `${ts}-me`, from: 'You', text, ts, own: true, replyTo: replyingTo ?? undefined },
        ]);
        setChatInput('');
        setReplyingTo(null);
        chatInputRef.current?.focus();
    };

    const handleLeave = () => { disconnect(); stop(); navigate('/'); };

    const peerList = [...peers.values()];
    const totalPeople = peerList.length + 1; // include self

    if (roomError) {
        return (
            <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
                <div className="glass-card" style={{ padding: '48px 32px', textAlign: 'center', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ fontSize: '4rem' }}>😔</div>
                    <h2>{roomError}</h2>
                    <p>The room may be full, expired, or not found.</p>
                    <button className="btn btn-primary" onClick={() => navigate('/')}>Go Home</button>
                    <button className="btn btn-secondary" onClick={() => navigate('/create')}>Create New Room</button>
                </div>
            </div>
        );
    }

    return (
        <div className="room-page">
            {/* ── Header ── */}
            <div className="room-header">
                <div className="room-code-badge">🔐 {roomCode.slice(0, 8)}…</div>
                <div className="room-status">
                    {connected ? <span className="dot-connected" /> : <span className="dot-connecting" />}
                    {connected ? `${totalPeople} in room` : 'Connecting…'}
                    <span className="network-tier-badge">{TIER_LABEL[networkTier]}</span>
                    {recordingDetected && (
                        <span className="recording-detected-badge" title={`Recording signal detected (${recordingSource})`}>
                            🔴 Face Hidden
                        </span>
                    )}
                </div>
                <div className="room-header-actions">
                    <button
                        className={`btn btn-ghost btn-sm`}
                        onClick={() => { setChatOpen(o => !o); }}
                        style={{ position: 'relative' }}
                    >
                        💬 {chatOpen ? 'Close' : 'Chat'}
                        {messages.length > 0 && !chatOpen && (
                            <span style={{
                                position: 'absolute', top: -4, right: -4,
                                background: '#6366f1', color: '#fff',
                                fontSize: '0.6rem', fontWeight: 700,
                                width: 16, height: 16, borderRadius: '50%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                {messages.length > 9 ? '9+' : messages.length}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* ── Body: video + chat ── */}
            <div className="room-body">
                {/* ── Video area ── */}
                <div className="video-area">
                    {expandedPeer ? (
                        <div className="expanded-view">
                            {expandedPeer === 'local' ? (
                                <div className="expanded-canvas-wrapper">
                                    <canvas ref={canvasRef} className="expanded-canvas" />
                                    <span className={`blur-status-badge-float badge ${blurOptions.enabled ? 'badge-on' : 'badge-off'}`}>
                                        {blurOptions.enabled ? '🛡️ Blur ON' : '⚠️ Blur OFF'}
                                    </span>
                                    <button className="shrink-btn" onClick={() => setExpandedPeer(null)}>⤡ Shrink</button>
                                </div>
                            ) : (
                                <VideoTile
                                    stream={peers.get(expandedPeer)?.stream ?? null}
                                    label={`Anon ${expandedPeer.slice(0, 4).toUpperCase()}`}
                                    blurOn={true}
                                    onClick={() => setExpandedPeer(null)}
                                />
                            )}
                        </div>
                    ) : (
                        <div className={`video-grid peers-${Math.min(totalPeople, 6)}`}>
                            {/* Local tile */}
                            <div className="local-tile-wrapper" onClick={() => setExpandedPeer('local')}>
                                <canvas ref={canvasRef} className="local-canvas" />
                                <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
                                <div className="tile-overlays">
                                    <div className="tile-label">You</div>
                                    <div className="tile-badges">
                                        {micMuted && <span className="tile-badge">🔇</span>}
                                        {!cameraEnabled && <span className="tile-badge">📷</span>}
                                        <span className={`tile-badge ${blurOptions.enabled ? 'blur-on-badge' : 'blur-off-badge'}`}>
                                            {blurOptions.enabled ? '🛡️' : '⚠️'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Remote peers */}
                            {peerList.map(peer => (
                                <VideoTile
                                    key={peer.peerId}
                                    stream={peer.stream}
                                    label={`Anon ${peer.peerId.slice(0, 4).toUpperCase()}`}
                                    isMuted={peer.muted}
                                    isVideoOff={peer.videoOff}
                                    blurOn={true}
                                    onClick={() => setExpandedPeer(peer.peerId)}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Chat panel (WhatsApp style) ── */}
                {chatOpen && (
                    <div className="chat-panel">
                        <div className="chat-header">
                            <h4>💬 Room Chat</h4>
                            <button className="chat-close-btn" onClick={() => setChatOpen(false)}>✕</button>
                        </div>

                        <div className="chat-messages">
                            {messages.length === 0 && (
                                <div className="chat-empty">No messages yet<br />Say hi! 👋</div>
                            )}
                            {messages.map(m => (
                                <div key={m.id} className={`chat-msg ${m.own ? 'chat-own' : 'chat-peer'}`}>
                                    {!m.own && <span className="chat-from">{m.from}</span>}
                                    <div className="chat-msg-row">
                                        <div className="chat-bubble">
                                            {m.replyTo && (
                                                <div className="reply-quote">
                                                    <span className="reply-quote-sender">{m.replyTo.from}:</span>
                                                    {m.replyTo.text}
                                                </div>
                                            )}
                                            {m.text}
                                        </div>
                                        <button
                                            className="reply-btn"
                                            title="Reply"
                                            onClick={() => {
                                                setReplyingTo({ from: m.own ? 'You' : m.from, text: m.text });
                                                chatInputRef.current?.focus();
                                            }}
                                        >↩</button>
                                    </div>
                                    <span className="chat-time">{formatTime(m.ts)}</span>
                                </div>
                            ))}
                            <div ref={chatEndRef} />
                        </div>

                        {/* Reply preview strip */}
                        {replyingTo && (
                            <div className="reply-preview">
                                <span>↩</span>
                                <span className="reply-preview-text">
                                    <strong>{replyingTo.from}:</strong> {replyingTo.text}
                                </span>
                                <button className="reply-preview-close" onClick={() => setReplyingTo(null)}>✕</button>
                            </div>
                        )}

                        <form className="chat-input-row" onSubmit={handleSendChat}>
                            <input
                                ref={chatInputRef}
                                className="chat-input"
                                value={chatInput}
                                onChange={e => setChatInput(e.target.value)}
                                placeholder={connected ? 'Type a message…' : 'Connecting…'}
                                maxLength={500}
                                disabled={!connected}
                                autoComplete="off"
                            />
                            <button
                                type="submit"
                                className="chat-send-btn"
                                disabled={!chatInput.trim() || !connected}
                                title="Send"
                            >
                                ➤
                            </button>
                        </form>
                    </div>
                )}
            </div>

            {/* ── Controls bar ── */}
            <div className="room-controls">
                {/* Reaction tray sits inside the controls wrapper */}
                <EmojiReactions
                    reactions={reactions}
                    onReact={(emoji) => {
                        sendReaction(emoji);
                        // Also show own reaction locally
                        handleReaction('me', emoji);
                    }}
                />

                <button
                    className={`ctrl-btn ${micMuted || (pttMode && !pttActiveRef.current) ? 'muted' : ''}`}
                    onClick={toggleMic}
                    title={micMuted ? 'Unmute' : 'Mute'}
                >
                    {micMuted ? '🔇' : '🎤'}
                    <span>{micMuted ? 'Unmute' : 'Mute'}</span>
                </button>

                {/* Feature 3: Push-to-Talk toggle */}
                <button
                    className={`ctrl-btn ${pttMode ? 'active' : ''}`}
                    onClick={() => setPttMode(m => !m)}
                    title={pttMode ? 'PTT On — Hold Space to speak' : 'Enable Push-to-Talk'}
                >
                    🎙️<span>{pttMode ? 'PTT: On' : 'PTT'}</span>
                </button>

                <button
                    className={`ctrl-btn ${!cameraEnabled ? 'muted' : ''}`}
                    onClick={toggleCamera}
                    title={cameraEnabled ? 'Stop Video' : 'Start Video'}
                >
                    {cameraEnabled ? '📹' : '📷'}
                    <span>{cameraEnabled ? 'Camera' : 'Cam Off'}</span>
                </button>

                {/* Feature 1: Screen Share */}
                <button
                    className={`ctrl-btn ${isScreenSharing ? 'active' : ''}`}
                    onClick={shareScreen}
                    title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
                >
                    🖥️<span>{isScreenSharing ? 'Stop' : 'Share'}</span>
                </button>

                <button
                    className={`ctrl-btn ${blurOptions.enabled ? 'active' : ''}`}
                    onClick={() => setBlurPanelOpen(o => !o)}
                    title="Blur settings"
                >
                    🛡️
                    <span>Blur</span>
                </button>

                <button
                    className={`ctrl-btn ${activeFacingMode === 'environment' ? 'active' : ''}`}
                    onClick={() => switchCamera()}
                    title={activeFacingMode === 'user' ? 'Switch to back camera' : 'Switch to front camera'}
                >
                    {activeFacingMode === 'user' ? '🔄' : '🔁'}
                    <span>{activeFacingMode === 'user' ? 'Flip' : 'Front'}</span>
                </button>

                <button
                    className="ctrl-btn"
                    onClick={() => setChatOpen(o => !o)}
                >
                    💬
                    <span>Chat</span>
                </button>

                <button className="ctrl-btn danger" onClick={handleLeave} title="Leave">
                    📵
                    <span>Leave</span>
                </button>
            </div>

            {/* ── Blur settings panel ── */}
            {blurPanelOpen && (
                <div className="blur-panel glass-card">
                    <h3>🛡️ Blur Settings</h3>
                    <label className="blur-toggle">
                        <input type="checkbox" checked={blurOptions.enabled}
                            onChange={e => setBlurOptions(o => ({ ...o, enabled: e.target.checked }))} />
                        Enable face blur
                    </label>
                    <label>
                        Mode
                        <select value={blurOptions.mode}
                            onChange={e => setBlurOptions(o => ({ ...o, mode: e.target.value as BlurMode }))}>
                            <option value="gaussian">Gaussian</option>
                            <option value="pixelate">Pixelate</option>
                            <option value="mask">Mask</option>
                        </select>
                    </label>
                    <label>
                        Strength: {blurOptions.strength}
                        <input type="range" min={1} max={20} value={blurOptions.strength}
                            onChange={e => setBlurOptions(o => ({ ...o, strength: Number(e.target.value) }))} />
                    </label>
                    <button className="btn btn-ghost btn-sm" onClick={() => setBlurPanelOpen(false)}>Close</button>
                </div>
            )}

            {/* ── Feature 4: Partner Left overlay ── */}
            {callEnded && (
                <div className="call-ended-overlay" role="dialog" aria-label="Call ended">
                    <div className="call-ended-card glass-card">
                        <div className="call-ended-icon">👋</div>
                        <h2>Call Ended</h2>
                        <p>Everyone else has left the room.</p>
                        <div className="call-ended-actions">
                            <button className="btn btn-primary" onClick={() => { setCallEnded(false); hadPeersRef.current = false; }}>
                                Stay in Room
                            </button>
                            <button className="btn btn-ghost" onClick={handleLeave}>
                                Leave
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Feature 5: Waiting Room overlay (shown to joiner) ── */}
            {isWaitingOverlay && (
                <div className="waiting-overlay" role="status" aria-label="Waiting for admission">
                    <div className="waiting-card glass-card">
                        <div className="waiting-spinner" />
                        <h2>Waiting for host…</h2>
                        <p>The host will admit you shortly.</p>
                        <button className="btn btn-ghost btn-sm" onClick={handleLeave}>Cancel</button>
                    </div>
                </div>
            )}

            {/* ── Feature 5: Waiting Room — host admission toast ── */}
            {waitingPeers.length > 0 && (
                <div className="admit-toast" role="dialog" aria-label="Peer requesting admission">
                    <div className="admit-toast-body">
                        <span className="admit-toast-icon">🚪</span>
                        <span>
                            <strong>{waitingPeers[0].slice(0, 8)}…</strong> wants to join
                        </span>
                    </div>
                    <div className="admit-toast-actions">
                        <button className="btn btn-primary btn-sm" onClick={() => {
                            approvePeer(waitingPeers[0]);
                            setWaitingPeers(p => p.slice(1));
                        }}>Admit</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => {
                            rejectPeer(waitingPeers[0]);
                            setWaitingPeers(p => p.slice(1));
                        }}>Reject</button>
                    </div>
                </div>
            )}

            {/* ── External Recording Threat Toast ── */}
            {backCam.threatDetected && !threatToastDismissed && (
                <div className="threat-toast" role="alert">
                    <span className="threat-toast-icon">⚠️</span>
                    <div className="recording-toast-body">
                        <strong>External Camera Detected!</strong>
                        <span>{backCam.threatReason || 'A recording device may be pointed at your screen.'}</span>
                    </div>
                    <button
                        className="recording-toast-close"
                        aria-label="Dismiss"
                        onClick={() => setThreatToastDismissed(true)}
                    >✕</button>
                </div>
            )}
            {recordingDetected && !recordingToastDismissed && (
                <div className="recording-toast" role="alert">
                    <span className="recording-toast-icon">🛡️</span>
                    <div className="recording-toast-body">
                        <strong>Recording Detected</strong>
                        <span>Your face is now fully hidden to protect your privacy.</span>
                    </div>
                    <button
                        className="recording-toast-close"
                        aria-label="Dismiss"
                        onClick={() => setRecordingToastDismissed(true)}
                    >✕</button>
                </div>
            )}
        </div>
    );
}
