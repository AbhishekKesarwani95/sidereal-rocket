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
    const abortRef = useRef<AbortController | null>(null);
    const stableLocalRef = useRef<MediaStream>(new MediaStream());

    // ── Blur hook ────────────────────────────────────────────────────────────
    const { videoRef, canvasRef, blurredStreamState, start, stop } = useFaceBlur(DEFAULT_BLUR_OPTIONS);

    // ── Assemble combined stream whenever blur or mic changes ─────────────────
    // FIX: use blurredStreamState (React state) not blurredStream.current (ref)
    // so this effect re-runs when the canvas stream becomes available.
    useEffect(() => {
        const s = stableLocalRef.current;
        s.getVideoTracks().forEach(t => s.removeTrack(t));
        blurredStreamState?.getVideoTracks().forEach(t => s.addTrack(t));
        s.getAudioTracks().forEach(t => s.removeTrack(t));
        micStream?.getAudioTracks().forEach(t => s.addTrack(t));
        // Force re-render so useWebRTC sees updated stream
        setLocalStream(new MediaStream(s.getTracks()));
    }, [blurredStreamState, micStream]);

    // ── WebRTC ────────────────────────────────────────────────────────────────
    const { peers, connect, disconnect } = useWebRTC({
        roomCode: activeRoom ?? '',
        localStream,
        onError: () => skipToNext(),
    });

    // ── Start camera + mic on mount ───────────────────────────────────────────
    useEffect(() => {
        start();
        navigator.mediaDevices?.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
        }).then(setMicStream).catch(() => { });
        return () => { stop(); abortRef.current?.abort(); };
    }, []); // eslint-disable-line

    // ── Connect when room is assigned ─────────────────────────────────────────
    const didConnect = useRef(false);
    useEffect(() => {
        if (!activeRoom || !localStream || didConnect.current) return;
        didConnect.current = true;
        connect();
    }, [activeRoom, localStream]); // eslint-disable-line

    // ── Search timer display ──────────────────────────────────────────────────
    useEffect(() => {
        if (step !== 'searching') { setSearchSeconds(0); return; }
        const t = setInterval(() => setSearchSeconds(s => s + 1), 1000);
        return () => clearInterval(t);
    }, [step]);

    // ── Matchmaking: call server queue endpoint ────────────────────────────────
    const startSearch = useCallback(async () => {
        setStep('searching');
        setError('');
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
                didConnect.current = false;
                setActiveRoom(code);
                setStep('call');
            }
        } catch (e: unknown) {
            if ((e as Error).name === 'AbortError') return; // user cancelled
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
        didConnect.current = false;
        startSearch();
    }, [disconnect, startSearch]);

    const endCall = useCallback(() => {
        disconnect();
        abortRef.current?.abort();
        navigate('/');
    }, [disconnect, navigate]);

    const toggleInterest = (i: string) =>
        setSelectedInterests(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);

    const peerList = [...peers.values()];

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
                        Match 1-to-1 with a stranger based on shared interests. All faces blurred. Skip anytime.
                    </p>

                    {/* Camera preview — shows blur is working before you join */}
                    <div className="random-preview glass-card">
                        <canvas ref={canvasRef} className="random-canvas" aria-label="Your blurred preview" />
                        <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
                        <span className="badge badge-on" style={{ position: 'absolute', top: 8, left: 8 }}>🛡️ BLUR ON</span>
                    </div>

                    <form onSubmit={handleStartSearch} className="glass-card random-form">
                        <div className="form-group">
                            <label htmlFor="rnd-name">Display Alias *</label>
                            <input id="rnd-name" value={name} onChange={e => setName(e.target.value)} placeholder="How others see you (e.g. StrangerA)" maxLength={20} required />
                        </div>
                        <div className="form-group">
                            <label htmlFor="rnd-age">Age * (18+)</label>
                            <input id="rnd-age" type="number" min={18} max={99} value={age} onChange={e => setAge(e.target.value)} placeholder="Your age" required />
                        </div>
                        <div className="form-group">
                            <label>Interests <span style={{ color: 'var(--clr-text-3)', fontWeight: 400 }}>(optional — matched first if overlap found)</span></label>
                            <div className="interest-chips">
                                {INTERESTS_LIST.map(i => (
                                    <button key={i} type="button"
                                        className={`interest-chip ${selectedInterests.includes(i) ? 'chip-active' : ''}`}
                                        onClick={() => toggleInterest(i)}>
                                        {i}
                                    </button>
                                ))}
                            </div>
                            {selectedInterests.length > 0 && (
                                <p style={{ fontSize: '0.78rem', color: 'var(--clr-text-3)', marginTop: 8 }}>
                                    ✅ You'll be matched with someone who shares at least one interest. If none found, matched randomly.
                                </p>
                            )}
                        </div>
                        {error && <div className="error-box">⚠️ {error}</div>}
                        <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                            🎲 Find Someone to Talk To
                        </button>
                    </form>
                    <div style={{ marginTop: 'var(--sp-5)' }}><AdBanner variant="horizontal" label="Advertisement" /></div>
                </div>

                <style>{`
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
        `}</style>
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
                        ? `Looking for someone interested in ${selectedInterests.slice(0, 3).join(', ')}${selectedInterests.length > 3 ? '…' : ''}`
                        : 'Matching you with a random anonymous stranger'}
                </p>
                <p style={{ color: 'var(--clr-text-3)', fontSize: '0.85rem' }}>{searchSeconds}s elapsed</p>
                <button className="btn btn-ghost" onClick={() => { abortRef.current?.abort(); setStep('profile'); }}>
                    ✕ Cancel
                </button>
                <style>{`
          .random-searching { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-4); text-align: center; }
          .search-orb { position: relative; width: 100px; height: 100px; display: flex; align-items: center; justify-content: center; }
          .orb-ring { position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(99,102,241,0.4); animation: orb-pulse 2s ease-in-out infinite; }
          .orb-ring-2 { animation-delay: 1s; border-color: rgba(6,182,212,0.3); }
          @keyframes orb-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.3; } }
        `}</style>
            </div>
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IN CALL STEP
    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="random-call-active">
            <div className="random-call-header">
                <span className="badge badge-accent">🎲 Random Call</span>
                <div style={{ flex: 1, textAlign: 'center', fontSize: '0.85rem', color: 'var(--clr-text-3)' }}>
                    {peerList.length === 0 ? 'Connecting peer…' : `Connected — 1-to-1 Anonymous`}
                </div>
                <button className="btn btn-danger btn-sm" onClick={endCall}>📵 End</button>
            </div>

            <div className="random-call-grid">
                {/* Remote peer video */}
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

                {/* Self preview — small overlay */}
                <div className="self-tile-small">
                    <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--rad-lg)' }} />
                    <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
                    <span className="badge badge-on" style={{ position: 'absolute', bottom: 6, left: 6, fontSize: '0.6rem' }}>🛡️</span>
                </div>
            </div>

            <div className="random-controls">
                <button className="btn btn-secondary btn-lg" onClick={skipToNext}>⏩ Skip / Next</button>
                <button className="btn btn-danger btn-lg" onClick={endCall}>📵 End Call</button>
            </div>

            <style>{`
        .random-call-active { height: 100dvh; display: flex; flex-direction: column; background: var(--clr-bg); }
        .random-call-header { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--clr-border); background: var(--glass-bg); flex-shrink: 0; }
        .random-call-grid { flex: 1; position: relative; background: #050a15; overflow: hidden; }
        .peer-tile-main { width: 100%; height: 100%; }
        .peer-tile-main > * { width: 100% !important; height: 100% !important; aspect-ratio: unset !important; border-radius: 0 !important; }
        .self-tile-small { position: absolute; bottom: var(--sp-4); right: var(--sp-4); width: 140px; height: 100px; border-radius: var(--rad-lg); overflow: hidden; border: 2px solid var(--clr-primary); box-shadow: var(--shadow-primary); background: #0a1120; }
        .waiting-connect { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-4); color: var(--clr-text-2); }
        .random-controls { display: flex; align-items: center; justify-content: center; gap: var(--sp-4); padding: var(--sp-4); background: var(--glass-bg); border-top: 1px solid var(--clr-border); flex-shrink: 0; flex-wrap: wrap; }
        .search-orb { position: relative; display: flex; align-items: center; justify-content: center; }
        .orb-ring { position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(99,102,241,0.4); animation: orb-pulse 2s ease-in-out infinite; }
        .orb-ring-2 { animation-delay: 1s; border-color: rgba(6,182,212,0.3); }
        @keyframes orb-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.3; } }
      `}</style>
        </div>
    );
}
