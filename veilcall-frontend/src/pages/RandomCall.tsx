import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFaceBlur, DEFAULT_BLUR_OPTIONS } from '../hooks/useFaceBlur';
import { useWebRTC } from '../hooks/useWebRTC';
import VideoTile from '../components/VideoTile';
import AdBanner from '../components/AdBanner';

const API_BASE = import.meta.env.VITE_API_BASE || '';

const INTERESTS_LIST = [
    'Music', 'Movies', 'Gaming', 'Art', 'Tech', 'Travel', 'Food', 'Sports',
    'Books', 'Fitness', 'Anime', 'Photography', 'Comedy', 'Science', 'Fashion',
];

interface ChatMsg { text: string; fromMe: boolean; ts: number; }

export default function RandomCall() {
    const navigate = useNavigate();
    const [step, setStep] = useState<'profile' | 'searching' | 'call'>('profile');
    const [name, setName] = useState('');
    const [age, setAge] = useState('');
    const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
    const [activeRoom, setActiveRoom] = useState<string | null>(null);
    const [micStream, setMicStream] = useState<MediaStream | null>(null);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState('');
    const [searchSeconds, setSearchSeconds] = useState(0);
    const [chatOpen, setChatOpen] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
    const [micMuted, setMicMuted] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    // ── Blur hook ─────────────────────────────────────────────────────────────
    const { videoRef, canvasRef, blurredStreamState, start, stop } = useFaceBlur(DEFAULT_BLUR_OPTIONS);

    // ── Assemble combined stream ──────────────────────────────────────────────
    // Using blurredStreamState (React state, not ref) so this effect fires
    // when the canvas stream becomes available after MediaPipe initializes.
    useEffect(() => {
        const tracks: MediaStreamTrack[] = [];
        blurredStreamState?.getVideoTracks().forEach(t => tracks.push(t));
        micStream?.getAudioTracks().forEach(t => tracks.push(t));
        if (tracks.length === 0) return;
        setLocalStream(new MediaStream(tracks));
    }, [blurredStreamState, micStream]);

    // ── WebRTC — autoConnect fires once roomCode + localStream are both ready ──
    const { peers, disconnect, sendChatMessage } = useWebRTC({
        roomCode: activeRoom ?? '',
        localStream,
        autoConnect: !!activeRoom,          // hook self-connects when both are ready
        onChatMessage: (text, _from) => {
            setChatMsgs(prev => [...prev, { text, fromMe: false, ts: Date.now() }]);
        },
        onError: () => skipToNext(),
    });

    // ── Camera + mic on mount ─────────────────────────────────────────────────
    useEffect(() => {
        start();
        navigator.mediaDevices?.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
        }).then(setMicStream).catch(() => { });
        return () => { stop(); abortRef.current?.abort(); };
    }, []); // eslint-disable-line

    // ── Scroll chat to bottom ─────────────────────────────────────────────────
    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMsgs]);

    // ── Search timer ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (step !== 'searching') { setSearchSeconds(0); return; }
        const t = setInterval(() => setSearchSeconds(s => s + 1), 1000);
        return () => clearInterval(t);
    }, [step]);

    // ── Matchmaking ───────────────────────────────────────────────────────────
    const startSearch = useCallback(async () => {
        setStep('searching');
        setError('');
        setChatMsgs([]);
        const abort = new AbortController();
        abortRef.current = abort;
        try {
            const res = await fetch(`${API_BASE}/api/random-match`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ interests: selectedInterests }),
                signal: abort.signal,
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Matchmaking failed');
            }
            const { code } = await res.json();
            if (!abort.signal.aborted) {
                setActiveRoom(code);
                setStep('call');
            }
        } catch (e: unknown) {
            if ((e as Error).name === 'AbortError') return;
            setError((e as Error).message || 'Could not connect. Try again.');
            setStep('profile');
        }
    }, [selectedInterests]);

    const handleStartSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) { setError('Please enter a display alias'); return; }
        const numAge = Number(age);
        if (!age || numAge < 18 || numAge > 99) { setError('Must be 18+ to use random calls'); return; }
        setError('');
        startSearch();
    };

    const skipToNext = useCallback(() => {
        disconnect();
        abortRef.current?.abort();
        setActiveRoom(null);
        startSearch();
    }, [disconnect, startSearch]);

    const endCall = useCallback(() => {
        disconnect();
        abortRef.current?.abort();
        navigate('/');
    }, [disconnect, navigate]);

    const toggleMic = useCallback(() => {
        micStream?.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
        setMicMuted(m => !m);
    }, [micStream]);

    const sendChat = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        const text = chatInput.trim();
        if (!text) return;
        sendChatMessage(text);
        setChatMsgs(prev => [...prev, { text, fromMe: true, ts: Date.now() }]);
        setChatInput('');
    }, [chatInput, sendChatMessage]);

    const toggleInterest = (i: string) =>
        setSelectedInterests(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);

    const peerList = [...peers.values()];
    const newMsgCount = chatOpen ? 0 : chatMsgs.filter(m => !m.fromMe).length;

    // ─────────────────────────────────────────────────────────────────────────
    // PROFILE STEP
    // ─────────────────────────────────────────────────────────────────────────
    if (step === 'profile') {
        return (
            <div className="page-wrapper random-page">
                <div className="container" style={{ maxWidth: 560, paddingTop: 'var(--sp-10)' }}>
                    <a href="/" className="btn btn-ghost btn-sm">← Back</a>
                    <h2 style={{ margin: 'var(--sp-5) 0 var(--sp-2)' }}>🎲 <span className="grad-text">Random Anonymous Call</span></h2>
                    <p style={{ marginBottom: 'var(--sp-6)', color: 'var(--clr-text-2)' }}>
                        1-to-1 private call with a stranger. Matched by interests. All faces auto-blurred.
                    </p>

                    <div className="random-preview glass-card">
                        <canvas ref={canvasRef} className="random-canvas" aria-label="Your blurred preview" />
                        <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
                        <span className="badge badge-on" style={{ position: 'absolute', top: 8, left: 8 }}>🛡️ BLUR ON</span>
                    </div>

                    <form onSubmit={handleStartSearch} className="glass-card random-form">
                        <div className="form-group">
                            <label htmlFor="rnd-name">Display Alias *</label>
                            <input id="rnd-name" value={name} onChange={e => setName(e.target.value)}
                                placeholder="How others see you (e.g. StrangerA)" maxLength={20} required />
                        </div>
                        <div className="form-group">
                            <label htmlFor="rnd-age">Age * (18+)</label>
                            <input id="rnd-age" type="number" min={18} max={99} value={age}
                                onChange={e => setAge(e.target.value)} placeholder="Your age" required />
                        </div>
                        <div className="form-group">
                            <label>
                                Interests&nbsp;
                                <span style={{ color: 'var(--clr-text-3)', fontWeight: 400 }}>
                                    (optional — matched first if overlap found, else random)
                                </span>
                            </label>
                            <div className="interest-chips">
                                {INTERESTS_LIST.map(i => (
                                    <button key={i} type="button"
                                        className={`interest-chip ${selectedInterests.includes(i) ? 'chip-active' : ''}`}
                                        onClick={() => toggleInterest(i)}>
                                        {i}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {error && <div className="error-box">⚠️ {error}</div>}
                        <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                            🎲 Find Someone to Talk To
                        </button>
                    </form>
                    <div style={{ marginTop: 'var(--sp-5)' }}><AdBanner variant="horizontal" label="Advertisement" /></div>
                </div>
                <style>{PROFILE_CSS}</style>
            </div>
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEARCHING STEP
    // ─────────────────────────────────────────────────────────────────────────
    if (step === 'searching') {
        const dots = '.'.repeat((searchSeconds % 3) + 1);
        return (
            <div className="random-searching">
                <div className="search-orb">
                    <div className="orb-ring" />
                    <div className="orb-ring orb-ring-2" />
                    <span style={{ fontSize: '2.5rem' }}>🎲</span>
                </div>
                <h3>Finding your match{dots}</h3>
                <p style={{ color: 'var(--clr-text-2)', maxWidth: 320, textAlign: 'center' }}>
                    {selectedInterests.length > 0
                        ? `Looking for: ${selectedInterests.slice(0, 3).join(', ')}${selectedInterests.length > 3 ? '…' : ''}`
                        : 'Matching you with a random anonymous stranger'}
                </p>
                <p style={{ color: 'var(--clr-text-3)', fontSize: '0.85rem' }}>{searchSeconds}s elapsed</p>
                <button className="btn btn-ghost" onClick={() => { abortRef.current?.abort(); setStep('profile'); }}>
                    ✕ Cancel
                </button>
                <style>{SEARCHING_CSS}</style>
            </div>
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IN CALL
    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="random-call-active">
            {/* Header */}
            <div className="random-call-header">
                <span className="badge badge-accent">🎲 Random</span>
                <div className="call-status">
                    {peerList.length === 0 ? 'Connecting…' : '🟢 Connected · 1-to-1'}
                </div>
                <div className="header-actions">
                    <button className={`ctrl-btn-sm ${micMuted ? 'muted' : ''}`} onClick={toggleMic}
                        title={micMuted ? 'Unmute' : 'Mute'}>
                        {micMuted ? '🔇' : '🎤'}
                    </button>
                    <button className="ctrl-btn-sm chat-btn" onClick={() => setChatOpen(o => !o)} title="Chat">
                        💬{newMsgCount > 0 && <span className="chat-badge">{newMsgCount}</span>}
                    </button>
                </div>
            </div>

            <div className="call-body">
                {/* Remote peer video — full height */}
                <div className="random-call-grid">
                    <div className="peer-tile-main">
                        {peerList[0] ? (
                            <VideoTile stream={peerList[0].stream} label="Stranger" blurOn={false} />
                        ) : (
                            <div className="waiting-connect">
                                <div className="search-orb" style={{ width: 72, height: 72 }}>
                                    <div className="orb-ring" style={{ borderColor: 'rgba(99,102,241,0.5)' }} />
                                    <span style={{ fontSize: '1.8rem' }}>👤</span>
                                </div>
                                <p>Waiting for peer to connect…</p>
                            </div>
                        )}
                    </div>

                    {/* Self-preview — bottom-right overlay */}
                    <div className="self-tile-small">
                        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--rad-lg)' }} />
                        <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
                        <span className="badge badge-on" style={{ position: 'absolute', bottom: 6, left: 6, fontSize: '0.6rem' }}>🛡️</span>
                    </div>
                </div>

                {/* Chat panel — slides in from right */}
                {chatOpen && (
                    <div className="chat-panel">
                        <div className="chat-panel-header">
                            <span>💬 Chat</span>
                            <button className="btn btn-ghost btn-sm" onClick={() => setChatOpen(false)}>✕</button>
                        </div>
                        <div className="chat-messages">
                            {chatMsgs.length === 0 && (
                                <p className="chat-empty">Say hi 👋</p>
                            )}
                            {chatMsgs.map((m, i) => (
                                <div key={i} className={`chat-bubble ${m.fromMe ? 'mine' : 'theirs'}`}>
                                    {m.text}
                                </div>
                            ))}
                            <div ref={chatEndRef} />
                        </div>
                        <form className="chat-input-row" onSubmit={sendChat}>
                            <input
                                value={chatInput}
                                onChange={e => setChatInput(e.target.value)}
                                placeholder="Type a message…"
                                maxLength={300}
                                autoFocus
                            />
                            <button type="submit" className="btn btn-primary btn-sm">Send</button>
                        </form>
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className="random-controls">
                <button className="btn btn-secondary btn-lg" onClick={skipToNext}>⏩ Skip</button>
                <button className="btn btn-danger btn-lg" onClick={endCall}>📵 End</button>
            </div>

            <style>{CALL_CSS}</style>
        </div>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const PROFILE_CSS = `
  .random-page { min-height: 100dvh; }
  .random-preview { position: relative; overflow: hidden; margin-bottom: var(--sp-5); aspect-ratio: 16/9; background: #0a1120; }
  .random-canvas { width: 100%; height: 100%; object-fit: cover; display: block; }
  .random-form { padding: var(--sp-6); }
  .form-group { margin-bottom: var(--sp-5); }
  .form-group label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: var(--sp-2); color: var(--clr-text-2); }
  .interest-chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
  .interest-chip { padding: 6px 14px; border-radius: var(--rad-full); border: 1px solid var(--clr-border-2); background: var(--clr-surface); color: var(--clr-text-2); font-size: 0.8rem; cursor: pointer; transition: all var(--tr-fast); font-family: var(--font-head); }
  .interest-chip:hover { border-color: var(--clr-primary); color: var(--clr-text); }
  .chip-active { background: rgba(99,102,241,0.2) !important; border-color: var(--clr-primary) !important; color: var(--clr-primary-light) !important; }
  .error-box { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: var(--rad-md); padding: var(--sp-3) var(--sp-4); font-size: 0.875rem; color: var(--clr-danger-light); margin-bottom: var(--sp-4); }
`;

const SEARCHING_CSS = `
  .random-searching { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-4); text-align: center; }
  .search-orb { position: relative; width: 100px; height: 100px; display: flex; align-items: center; justify-content: center; }
  .orb-ring { position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(99,102,241,0.4); animation: orb-pulse 2s ease-in-out infinite; }
  .orb-ring-2 { animation-delay: 1s; border-color: rgba(6,182,212,0.3); }
  @keyframes orb-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.4; } }
`;

const CALL_CSS = `
  .random-call-active { height: 100dvh; display: flex; flex-direction: column; background: var(--clr-bg); }
  .random-call-header { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--clr-border); background: var(--glass-bg); flex-shrink: 0; }
  .call-status { flex: 1; text-align: center; font-size: 0.85rem; color: var(--clr-text-3); }
  .header-actions { display: flex; gap: var(--sp-2); }
  .ctrl-btn-sm { background: rgba(255,255,255,0.07); border: 1px solid var(--clr-border-2); border-radius: 10px; padding: 6px 12px; cursor: pointer; font-size: 1.1rem; color: var(--clr-text); transition: all 0.2s; position: relative; }
  .ctrl-btn-sm:hover { background: rgba(255,255,255,0.14); }
  .ctrl-btn-sm.muted { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.4); }
  .chat-badge { position: absolute; top: -5px; right: -5px; background: #ef4444; color: #fff; border-radius: 50%; font-size: 0.65rem; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; font-weight: 700; }
  .call-body { flex: 1; display: flex; overflow: hidden; }
  .random-call-grid { flex: 1; position: relative; background: #050a15; overflow: hidden; }
  .peer-tile-main { width: 100%; height: 100%; }
  .peer-tile-main > * { width: 100% !important; height: 100% !important; aspect-ratio: unset !important; border-radius: 0 !important; }
  .self-tile-small { position: absolute; bottom: var(--sp-4); right: var(--sp-4); width: 140px; height: 100px; border-radius: var(--rad-lg); overflow: hidden; border: 2px solid var(--clr-primary); box-shadow: var(--shadow-primary); background: #0a1120; z-index: 10; }
  .waiting-connect { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-4); color: var(--clr-text-2); }
  .search-orb { position: relative; display: flex; align-items: center; justify-content: center; }
  .orb-ring { position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(99,102,241,0.4); animation: orb-pulse 2s ease-in-out infinite; }
  .orb-ring-2 { animation-delay: 1s; border-color: rgba(6,182,212,0.3); }
  @keyframes orb-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.4; } }
  .chat-panel { width: 300px; min-width: 260px; display: flex; flex-direction: column; background: var(--clr-surface); border-left: 1px solid var(--clr-border); animation: slide-in-right 0.2s ease; }
  @keyframes slide-in-right { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  .chat-panel-header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--clr-border); font-weight: 600; flex-shrink: 0; }
  .chat-messages { flex: 1; overflow-y: auto; padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-2); }
  .chat-empty { color: var(--clr-text-3); font-size: 0.85rem; text-align: center; margin: auto; }
  .chat-bubble { max-width: 85%; padding: 8px 12px; border-radius: 12px; font-size: 0.875rem; line-height: 1.4; word-break: break-word; }
  .chat-bubble.mine { background: rgba(99,102,241,0.25); border: 1px solid rgba(99,102,241,0.4); align-self: flex-end; border-bottom-right-radius: 4px; }
  .chat-bubble.theirs { background: rgba(255,255,255,0.07); border: 1px solid var(--clr-border-2); align-self: flex-start; border-bottom-left-radius: 4px; }
  .chat-input-row { display: flex; gap: var(--sp-2); padding: var(--sp-3) var(--sp-4); border-top: 1px solid var(--clr-border); flex-shrink: 0; }
  .chat-input-row input { flex: 1; }
  .random-controls { display: flex; align-items: center; justify-content: center; gap: var(--sp-4); padding: var(--sp-4); background: var(--glass-bg); border-top: 1px solid var(--clr-border); flex-shrink: 0; flex-wrap: wrap; }
  @media (max-width: 600px) { .chat-panel { width: 100%; position: absolute; inset: 0; z-index: 20; } }
`;
