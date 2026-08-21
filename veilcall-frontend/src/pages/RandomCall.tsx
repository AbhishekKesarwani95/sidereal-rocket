import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFaceBlur, DEFAULT_BLUR_OPTIONS } from '../hooks/useFaceBlur';
import { useWebRTC } from '../hooks/useWebRTC';
import VideoTile from '../components/VideoTile';
import AdBanner from '../components/AdBanner';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

const INTERESTS_LIST = [
    'Music', 'Movies', 'Gaming', 'Art', 'Tech', 'Travel', 'Food', 'Sports',
    'Books', 'Fitness', 'Anime', 'Photography', 'Comedy', 'Science', 'Fashion',
];

interface PublicRoom { code: string; interests: string[]; participantCount: number; }

export default function RandomCall() {
    const navigate = useNavigate();
    const [step, setStep] = useState<'profile' | 'searching' | 'call'>('profile');
    const [name, setName] = useState('');
    const [age, setAge] = useState('');
    const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
    const [rooms, setRooms] = useState<PublicRoom[]>([]);
    const [currentRoomIdx, setCurrentRoomIdx] = useState(0);
    const [activeRoom, setActiveRoom] = useState<string | null>(null);
    const [skipTimer, _setSkipTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
    const [skipCountdown, setSkipCountdown] = useState(8);
    const [micStream, setMicStream] = useState<MediaStream | null>(null);
    const [combinedStream, setCombinedStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState('');

    const { videoRef, canvasRef, blurredStream, start, stop } = useFaceBlur(DEFAULT_BLUR_OPTIONS);

    const { peers, connect, disconnect } = useWebRTC({
        roomCode: activeRoom ?? '',
        localStream: combinedStream,
        onError: () => skipToNext(),
    });

    // Start camera on mount
    useEffect(() => {
        start();
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
            .then(setMicStream).catch(() => { });
        return () => { stop(); };
    }, [start, stop]);

    useEffect(() => {
        if (!blurredStream.current) return;
        const combined = new MediaStream();
        blurredStream.current.getVideoTracks().forEach(t => combined.addTrack(t));
        micStream?.getAudioTracks().forEach(t => combined.addTrack(t));
        setCombinedStream(combined);
    }, [blurredStream.current, micStream]); // eslint-disable-line

    const fetchRooms = useCallback(async () => {
        try {
            const q = selectedInterests.length ? `?interests=${selectedInterests.join(',')}` : '';
            const res = await fetch(`${API_BASE}/api/public-rooms${q}`);
            const data = await res.json();
            setRooms(data.rooms || []);
            setCurrentRoomIdx(0);
        } catch { }
    }, [selectedInterests]);

    const joinRoom = useCallback(async (code: string) => {
        setActiveRoom(code);
        setStep('call');
    }, []);

    useEffect(() => {
        if (activeRoom && combinedStream) connect();
        return () => disconnect();
    }, [activeRoom, combinedStream]); // eslint-disable-line

    const skipToNext = useCallback(() => {
        disconnect();
        setActiveRoom(null);
        if (skipTimer) clearTimeout(skipTimer);
        const next = currentRoomIdx + 1;
        if (next < rooms.length) {
            setCurrentRoomIdx(next);
            setStep('searching');
            setTimeout(() => joinRoom(rooms[next].code), 1500);
        } else {
            // Re-fetch
            setStep('searching');
            fetchRooms();
        }
        setSkipCountdown(8);
    }, [currentRoomIdx, rooms, disconnect, fetchRooms, joinRoom, skipTimer]);

    // Auto-skip timer when in call
    useEffect(() => {
        if (step !== 'call') return;
        let count = 8;
        setSkipCountdown(count);
        const interval = setInterval(() => {
            count--;
            setSkipCountdown(count);
            if (count <= 0) { clearInterval(interval); }
        }, 1000);
        return () => clearInterval(interval);
    }, [step, activeRoom]);

    const handleStartSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) { setError('Please enter a name'); return; }
        const numAge = Number(age);
        if (!age || numAge < 18 || numAge > 99) { setError('Must be 18+ to use random calls'); return; }
        setError('');
        setStep('searching');
        await fetchRooms();
        if (rooms.length > 0) {
            joinRoom(rooms[0].code);
        } else {
            setError('No public rooms found. Try again or adjust your interests.');
            setStep('profile');
        }
    };

    const toggleInterest = (i: string) =>
        setSelectedInterests(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);

    const peerList = [...peers.values()];

    if (step === 'profile') {
        return (
            <div className="page-wrapper random-page">
                <div className="container" style={{ maxWidth: 560, paddingTop: 'var(--sp-10)' }}>
                    <a href="/" className="btn btn-ghost btn-sm">← Back</a>
                    <h2 style={{ margin: 'var(--sp-5) 0 var(--sp-2)' }}>🎲 <span className="grad-text">Random Anonymous Call</span></h2>
                    <p style={{ marginBottom: 'var(--sp-6)' }}>
                        Match with strangers based on shared interests. All faces blurred. Scroll/skip anytime.
                    </p>

                    {/* Camera preview */}
                    <div className="random-preview glass-card">
                        <canvas ref={canvasRef} className="random-canvas" aria-label="Your blurred preview" />
                        <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
                        <span className="badge badge-on" style={{ position: 'absolute', top: 8, left: 8 }}>🛡️ BLUR ON</span>
                    </div>

                    <form onSubmit={handleStartSearch} className="glass-card random-form">
                        <div className="form-group">
                            <label htmlFor="rnd-name">Display Alias *</label>
                            <input id="rnd-name" value={name} onChange={e => setName(e.target.value)} placeholder="How others will see you (e.g. StrangerA)" maxLength={20} required />
                        </div>
                        <div className="form-group">
                            <label htmlFor="rnd-age">Age * (18+)</label>
                            <input id="rnd-age" type="number" min={18} max={99} value={age} onChange={e => setAge(e.target.value)} placeholder="Your age" required />
                        </div>
                        <div className="form-group">
                            <label>Interests (optional — for better matching)</label>
                            <div className="interest-chips">
                                {INTERESTS_LIST.map(i => (
                                    <button key={i} type="button" className={`interest-chip ${selectedInterests.includes(i) ? 'chip-active' : ''}`} onClick={() => toggleInterest(i)}>
                                        {i}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {error && <div className="error-box">⚠️ {error}</div>}
                        <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>🎲 Find Someone to Talk To</button>
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

    if (step === 'searching') {
        return (
            <div className="random-searching">
                <div className="spinner" style={{ width: 48, height: 48, borderWidth: 4 }} />
                <h3>Finding someone…</h3>
                <p>Matching based on your interests with face blur enabled</p>
                <button className="btn btn-ghost" onClick={() => { setStep('profile'); disconnect(); }}>Cancel</button>
                <style>{`.random-searching { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-4); text-align: center; }`}</style>
            </div>
        );
    }

    // In call
    return (
        <div className="random-call-active">
            <div className="random-call-header">
                <span className="badge badge-accent">🎲 Random Call</span>
                <div style={{ flex: 1, textAlign: 'center', fontSize: '0.85rem', color: 'var(--clr-text-3)' }}>
                    {peerList.length === 0 ? 'Connecting…' : `Connected with Anon ${activeRoom?.slice(0, 4).toUpperCase()}`}
                </div>
                <span className="skip-timer">{skipCountdown > 0 ? `Auto-skip: ${skipCountdown}s` : ''}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => { disconnect(); navigate('/'); }}>✕ End</button>
            </div>

            <div className="random-call-grid">
                {/* Their video */}
                <div className="peer-tile-main">
                    {peerList[0] ? (
                        <VideoTile stream={peerList[0].stream} label={`Anon ${activeRoom?.slice(0, 4).toUpperCase() ?? ''}`} blurOn={true} />
                    ) : (
                        <div className="waiting-connect">
                            <div className="spinner" />
                            <p>Connecting peer…</p>
                        </div>
                    )}
                </div>
                {/* Self preview small */}
                <div className="self-tile-small" style={{ position: 'relative' }}>
                    <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--rad-lg)' }} />
                    <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
                    <span className="badge badge-on" style={{ position: 'absolute', bottom: 6, left: 6, fontSize: '0.6rem' }}>🛡️</span>
                </div>
            </div>

            <div className="random-controls">
                <button className="btn btn-danger btn-lg" onClick={skipToNext}>⏩ Skip / Next</button>
                <button className="btn btn-ghost" onClick={() => { disconnect(); navigate('/'); }}>📵 End</button>
            </div>

            <style>{`
        .random-call-active { height: 100dvh; display: flex; flex-direction: column; background: var(--clr-bg); }
        .random-call-header { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--clr-border); background: var(--glass-bg); flex-shrink: 0; }
        .skip-timer { font-size: 0.8rem; color: var(--clr-warning); font-weight: 600; }
        .random-call-grid { flex: 1; position: relative; background: #050a15; }
        .peer-tile-main { width: 100%; height: 100%; }
        .peer-tile-main > * { width: 100% !important; height: 100% !important; aspect-ratio: unset !important; border-radius: 0 !important; }
        .self-tile-small { position: absolute; bottom: var(--sp-4); right: var(--sp-4); width: 140px; height: 100px; border-radius: var(--rad-lg); overflow: hidden; border: 2px solid var(--clr-primary); box-shadow: var(--shadow-primary); background: #0a1120; }
        .waiting-connect { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-4); }
        .random-controls { display: flex; align-items: center; justify-content: center; gap: var(--sp-4); padding: var(--sp-4); background: var(--glass-bg); border-top: 1px solid var(--clr-border); flex-shrink: 0; }
      `}</style>
        </div>
    );
}
