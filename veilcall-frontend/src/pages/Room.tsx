import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import VideoTile from '../components/VideoTile';
import { useFaceBlur, DEFAULT_BLUR_OPTIONS, type BlurMode, type BlurOptions } from '../hooks/useFaceBlur';
import { useWebRTC } from '../hooks/useWebRTC';
import { useNetworkTier, TIER_LABEL } from '../hooks/useNetworkTier';
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
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const chatInputRef = useRef<HTMLInputElement>(null);
    const [replyingTo, setReplyingTo] = useState<{ from: string; text: string } | null>(null);

    const roomCode = code ?? '';

    const networkTier = useNetworkTier();

    const { videoRef, canvasRef, blurredStreamState, start, stop, pauseCamera, resumeCamera, cameraEnabled } = useFaceBlur(blurOptions, networkTier);

    // Assemble combined stream whenever video or mic changes
    useEffect(() => {
        if (!blurredStreamState) return;
        setLocalStream(new MediaStream([
            ...blurredStreamState.getVideoTracks(),
            ...(micStream?.getAudioTracks() ?? []),
        ]));
    }, [blurredStreamState, micStream]);

    // ── Must be defined BEFORE useWebRTC to satisfy Rules of Hooks ───────────
    const handleChatMessage = useCallback((from: string, text: string, ts: number, replyTo?: { from: string; text: string }) => {
        setMessages(prev => [
            ...prev,
            { id: `${ts}-${from}`, from: from.slice(0, 8), text, ts, own: false, replyTo },
        ]);
    }, []);

    const { peers, connected, connect, disconnect, sendChatMessage } = useWebRTC({
        roomCode,
        localStream,
        networkTier,
        onError: setRoomError,
        onChatMessage: handleChatMessage,
    });

    // ── Connect immediately on mount ─────────────────────────────────────────
    const didConnect = useRef(false);
    useEffect(() => {
        if (!roomCode || didConnect.current) return;
        didConnect.current = true;
        connect();
    }, [roomCode]); // eslint-disable-line

    // ── Start camera (non-blocking) ──────────────────────────────────────────
    useEffect(() => { start(); return () => stop(); }, []); // eslint-disable-line

    // ── Start mic (independent) ──────────────────────────────────────────────
    useEffect(() => {
        let ref: MediaStream | null = null;
        // navigator.mediaDevices is undefined on plain HTTP on mobile — guard required
        if (!navigator.mediaDevices?.getUserMedia) return;
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
            .then(s => { ref = s; setMicStream(s); })
            .catch(() => { });
        return () => { ref?.getTracks().forEach(t => t.stop()); };
    }, []); // eslint-disable-line

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
                <button
                    className={`ctrl-btn ${micMuted ? 'muted' : ''}`}
                    onClick={toggleMic}
                    title={micMuted ? 'Unmute' : 'Mute'}
                >
                    {micMuted ? '🔇' : '🎤'}
                    <span>{micMuted ? 'Unmute' : 'Mute'}</span>
                </button>

                <button
                    className={`ctrl-btn ${!cameraEnabled ? 'muted' : ''}`}
                    onClick={toggleCamera}
                    title={cameraEnabled ? 'Stop Video' : 'Start Video'}
                >
                    {cameraEnabled ? '📹' : '📷'}
                    <span>{cameraEnabled ? 'Camera' : 'Cam Off'}</span>
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
        </div>
    );
}
