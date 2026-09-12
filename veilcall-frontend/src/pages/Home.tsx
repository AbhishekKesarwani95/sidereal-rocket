import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdBanner from '../components/AdBanner';
import { usePWAInstall } from '../hooks/usePWAInstall';

const features = [
    { icon: '🕶️', title: 'Face Blurred by Default', desc: 'Your face is blurred on your device before it ever touches the network. You control when — and if — anyone sees the real you.' },
    { icon: '🔐', title: 'End-to-End Encrypted', desc: 'AES-256-GCM encryption via Insertable Streams. Not even our servers can see or hear your calls.' },
    { icon: '👻', title: 'Zero Login', desc: 'No email, no phone number, no tracking. Create a room, share the link, done.' },
    { icon: '⚡', title: 'Real-time WebRTC', desc: 'Direct peer-to-peer video — no media ever touches our servers. Ultra-low latency, crystal-clear quality.' },
    { icon: '🎲', title: 'Random Anonymous Calls', desc: 'Meet new people based on shared interests, all with blurred faces. Scroll to skip anytime.' },
    { icon: '📱', title: 'Works Everywhere', desc: 'Any browser, any device. Installable as a PWA for an app-like experience.' },
];

const trustPoints = [
    { icon: '🛡️', stat: '256-bit', label: 'AES-GCM Encryption', detail: 'Military-grade encryption applied per video frame.' },
    { icon: '🔑', stat: 'ECDH', label: 'Key Exchange', detail: 'Keys never leave your device. Zero server knowledge.' },
    { icon: '👁️', stat: '0 frames', label: 'Unblurred transmitted', detail: 'Blur is applied before WebRTC encoding. Always.' },
    { icon: '📝', stat: 'No logs', label: 'Zero persistence', detail: 'Nothing is stored. Room vanishes when everyone leaves.' },
];

const funCards = [
    { icon: '🎭', title: 'Be Anyone', desc: 'Blur your face and be a voice — the mystery is the fun.' },
    { icon: '🎮', title: 'Icebreaker Games', desc: 'Anonymous truth-or-dare, trivia battles, and word games built in.' },
    { icon: '🎨', title: 'Mask Your World', desc: 'Swap blur for a pixelated mask, solid silhouette, or custom overlay.' },
    { icon: '🌍', title: 'Global Random Calls', desc: 'Discover new friends worldwide. No face required to connect.' },
];

export default function Home() {
    const navigate = useNavigate();
    const [joinCode, setJoinCode] = useState('');
    const { canInstall, triggerInstall, isInstalled } = usePWAInstall();

    // Detect iOS — needs manual Add to Home Screen instructions
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const isInStandaloneMode = (window.matchMedia('(display-mode: standalone)').matches) || ((navigator as any).standalone === true);
    const showIOSHint = isIOS && !isInStandaloneMode && !isInstalled;

    const handleJoin = (e: React.FormEvent) => {
        e.preventDefault();
        const code = joinCode.trim().replace(/-/g, '');
        if (code) navigate(`/room/${code}`);
    };

    return (
        <div className="home-page">
            {/* Top ad leaderboard */}
            <div className="container" style={{ paddingTop: 'var(--sp-4)' }}>
                <AdBanner variant="leaderboard" label="Advertisement" />
            </div>

            {/* ── Hero ── */}
            <section className="hero">
                <div className="hero-glow hero-glow-1" />
                <div className="hero-glow hero-glow-2" />
                <div className="container hero-content animate-fade-in-up">
                    <span className="badge badge-accent" style={{ marginBottom: 'var(--sp-4)' }}>
                        🔒 Anonymous &amp; Encrypted
                    </span>
                    <h1>
                        Video calls with<br />
                        <span className="grad-text">no face, no fear.</span>
                    </h1>
                    <p className="hero-subtitle">
                        Veilcall automatically blurs every participant's face on their device,{' '}
                        adds military-grade encryption, and leaves zero logs. Meet anyone,{' '}
                        anywhere — completely anonymous.
                    </p>

                    {/* CTA grid */}
                    <div className="hero-cta-grid">
                        <button className="btn btn-primary btn-lg" onClick={() => navigate('/create')}>
                            <span>✨</span> Create a Room
                        </button>
                        <button className="btn btn-secondary btn-lg" onClick={() => navigate('/check-blur')}>
                            <span>🎭</span> Check Blur
                        </button>
                        <button className="btn btn-secondary btn-lg" onClick={() => navigate('/random')}>
                            <span>🎲</span> Random Call
                        </button>
                        <button className="btn btn-ghost btn-lg" onClick={() => navigate('/host')}>
                            <span>👑</span> Host Mode
                        </button>
                    </div>

                    {/* Quick join */}
                    <form onSubmit={handleJoin} className="quick-join">
                        <input
                            id="quick-join-code"
                            type="text"
                            placeholder="Enter room code to join…"
                            value={joinCode}
                            onChange={e => setJoinCode(e.target.value)}
                            maxLength={40}
                        />
                        <button type="submit" className="btn btn-primary">Join</button>
                    </form>

                    {/* PWA Install prompt — Android/Desktop */}
                    {canInstall && (
                        <button
                            className="pwa-install-banner"
                            onClick={triggerInstall}
                            aria-label="Install Veilcall as an app"
                        >
                            <span className="pwa-install-icon">📲</span>
                            <span className="pwa-install-text">
                                <strong>Add to Home Screen</strong>
                                <span>Install Veilcall for a faster app-like experience</span>
                            </span>
                            <span className="pwa-install-cta">Install →</span>
                        </button>
                    )}

                    {/* iOS: no beforeinstallprompt — show manual instructions */}
                    {showIOSHint && (
                        <div className="pwa-install-banner pwa-install-ios">
                            <span className="pwa-install-icon">📲</span>
                            <span className="pwa-install-text">
                                <strong>Add to Home Screen</strong>
                                <span>Tap <strong>Share ⎙</strong> → <strong>Add to Home Screen</strong></span>
                            </span>
                        </div>
                    )}
                </div>

                {/* Hero preview mockup */}
                <div className="hero-mockup animate-float">
                    <div className="mockup-card">
                        <div className="mockup-video-grid">
                            <div className="mockup-tile">
                                <div className="mockup-face mockup-face-blurred" />
                                <span className="badge badge-on" style={{ position: 'absolute', bottom: 8, left: 8, fontSize: '0.6rem' }}>● BLUR ON</span>
                            </div>
                            <div className="mockup-tile">
                                <div className="mockup-face mockup-face-blurred-2" />
                                <span className="badge badge-on" style={{ position: 'absolute', bottom: 8, left: 8, fontSize: '0.6rem' }}>● BLUR ON</span>
                            </div>
                        </div>
                        <div className="mockup-controls">
                            <span className="mockup-btn">🎤</span>
                            <span className="mockup-btn mockup-btn-danger">📵</span>
                            <span className="mockup-btn">📹</span>
                            <span className="mockup-btn">💬</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── Features grid ── */}
            <section className="section">
                <div className="container">
                    <div className="section-header">
                        <span className="badge badge-primary">Features</span>
                        <h2>Built for privacy.<br /><span className="grad-text">Designed for humans.</span></h2>
                    </div>
                    <div className="features-grid">
                        {features.map((f, i) => (
                            <div key={i} className="feature-card glass-card" style={{ animationDelay: `${i * 80}ms` }}>
                                <div className="feature-icon">{f.icon}</div>
                                <h3>{f.title}</h3>
                                <p>{f.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Mid-page ad ── */}
            <div className="container" style={{ marginBottom: 'var(--sp-12)' }}>
                <AdBanner variant="horizontal" label="Advertisement — Support Veilcall" />
            </div>

            {/* ── Trust section ── */}
            <section className="section trust-section">
                <div className="trust-bg" />
                <div className="container">
                    <div className="section-header">
                        <span className="badge badge-accent">Why people trust us</span>
                        <h2>Security you can <span className="grad-text">verify, not just believe.</span></h2>
                        <p>Every privacy claim is backed by open-source cryptography running entirely in your browser.</p>
                    </div>
                    <div className="trust-grid">
                        {trustPoints.map((t, i) => (
                            <div key={i} className="trust-card glass-card">
                                <div className="trust-icon">{t.icon}</div>
                                <div className="trust-stat">{t.stat}</div>
                                <div className="trust-label">{t.label}</div>
                                <div className="trust-detail">{t.detail}</div>
                            </div>
                        ))}
                    </div>
                    <div className="threat-model glass-card">
                        <h3>🔐 Threat Model — Plain Language</h3>
                        <div className="threat-grid">
                            <div className="threat-item threat-protected">
                                <div className="threat-header">✅ Protected Against</div>
                                <ul>
                                    <li>Curious server operators seeing your video</li>
                                    <li>TURN relay operators intercepting media</li>
                                    <li>Network sniffers on the wire</li>
                                    <li>Room codes being guessed (122-bit entropy)</li>
                                </ul>
                            </div>
                            <div className="threat-item threat-not-protected">
                                <div className="threat-header">⚠️ Not Protected Against</div>
                                <ul>
                                    <li>A compromised endpoint device</li>
                                    <li>Screen recording by the other participant</li>
                                    <li>Malware on your own device</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── Fun without face ── */}
            <section className="section">
                <div className="container">
                    <div className="section-header">
                        <span className="badge badge-primary">Fun Without Face</span>
                        <h2>Your voice, your vibe.<br /><span className="grad-text">No face needed.</span></h2>
                    </div>
                    <div className="fun-grid">
                        {funCards.map((f, i) => (
                            <div key={i} className="fun-card glass-card">
                                <div className="fun-icon animate-float" style={{ animationDelay: `${i * 0.5}s` }}>{f.icon}</div>
                                <h3>{f.title}</h3>
                                <p>{f.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Bottom ad ── */}
            <div className="container" style={{ marginBottom: 'var(--sp-16)' }}>
                <AdBanner variant="horizontal" label="Advertisement" />
            </div>

            {/* ── CTA Banner ── */}
            <section className="cta-banner">
                <div className="container">
                    <div className="cta-content glass-card">
                        <h2>Ready to call anonymously?</h2>
                        <p>No account. No face. Just secure, encrypted video.</p>
                        <button className="btn btn-primary btn-lg" onClick={() => navigate('/create')}>
                            Create Your Room →
                        </button>
                    </div>
                </div>
            </section>

            <style>{`
        .home-page { overflow-x: hidden; }

        /* Hero */
        .hero {
          min-height: 90vh;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--sp-12);
          padding: var(--sp-20) 0 var(--sp-16);
          position: relative;
          background: var(--grad-hero);
        }
        .hero-glow {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          pointer-events: none;
          animation: glow-pulse 4s ease-in-out infinite;
        }
        .hero-glow-1 { width: 600px; height: 600px; background: rgba(99,102,241,0.15); top: -200px; right: -100px; }
        .hero-glow-2 { width: 400px; height: 400px; background: rgba(6,182,212,0.1); bottom: 0; left: -100px; animation-delay: 2s; }
        .hero-content { flex: 1; min-width: 280px; max-width: 600px; }
        .hero-subtitle { font-size: clamp(1rem, 2vw, 1.15rem); max-width: 520px; margin: var(--sp-6) 0 var(--sp-8); }
        .hero-cta-grid { display: grid; grid-template-columns: repeat(2, auto); gap: var(--sp-3); justify-content: flex-start; margin-bottom: var(--sp-6); }
        @media (max-width: 480px) { .hero-cta-grid { grid-template-columns: 1fr 1fr; } }
        .quick-join { display: flex; gap: var(--sp-3); max-width: 420px; }
        .quick-join input { flex: 1; }

        /* Mockup */
        .hero-mockup { flex: 0 0 auto; display: flex; justify-content: center; padding: 0 var(--sp-6); }
        .mockup-card {
          background: var(--glass-bg);
          border: 1px solid var(--clr-border-2);
          border-radius: var(--rad-xl);
          padding: var(--sp-4);
          width: 320px;
          backdrop-filter: var(--glass-blur);
          box-shadow: var(--shadow-lg), var(--shadow-primary);
        }
        .mockup-video-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); margin-bottom: var(--sp-3); }
        .mockup-tile { aspect-ratio: 4/3; border-radius: var(--rad-lg); overflow: hidden; position: relative; background: #0d1a2d; }
        .mockup-face { position: absolute; inset: 0; }
        .mockup-face-blurred {
          background: radial-gradient(ellipse 60% 70% at 50% 35%, rgba(99,102,241,0.4), transparent 70%), #1a2540;
          filter: blur(12px);
        }
        .mockup-face-blurred-2 {
          background: radial-gradient(ellipse 60% 70% at 50% 35%, rgba(6,182,212,0.4), transparent 70%), #1a2540;
          filter: blur(12px);
        }
        .mockup-controls { display: flex; gap: var(--sp-3); justify-content: center; }
        .mockup-btn { width: 40px; height: 40px; border-radius: 50%; background: var(--clr-surface-2); display: flex; align-items: center; justify-content: center; font-size: 1rem; cursor: pointer; }
        .mockup-btn-danger { background: rgba(239,68,68,0.3); }

        /* Sections */
        .section { padding: var(--sp-20) 0; }
        .section-header { text-align: center; margin-bottom: var(--sp-12); }
        .section-header p { margin-top: var(--sp-4); max-width: 560px; margin-left: auto; margin-right: auto; }
        .section-header h2 { margin-top: var(--sp-3); }

        /* Features */
        .features-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--sp-6); }
        .feature-card { padding: var(--sp-8); transition: transform var(--tr-base), box-shadow var(--tr-base); animation: fadeInUp 0.6s ease both; }
        .feature-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg), var(--shadow-primary); }
        .feature-icon { font-size: 2.5rem; margin-bottom: var(--sp-4); }
        .feature-card h3 { margin-bottom: var(--sp-2); }
        .feature-card p { font-size: 0.9rem; }

        /* Trust */
        .trust-section { position: relative; overflow: hidden; }
        .trust-bg { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(99,102,241,0.08) 0%, transparent 70%); pointer-events: none; }
        .trust-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--sp-5); margin-bottom: var(--sp-8); }
        .trust-card { padding: var(--sp-8) var(--sp-6); text-align: center; }
        .trust-icon { font-size: 2rem; margin-bottom: var(--sp-3); }
        .trust-stat { font-family: var(--font-head); font-size: 1.8rem; font-weight: 700; background: var(--grad-primary); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .trust-label { font-weight: 600; margin: var(--sp-1) 0; }
        .trust-detail { font-size: 0.85rem; color: var(--clr-text-3); }
        .threat-model { padding: var(--sp-8); }
        .threat-model h3 { margin-bottom: var(--sp-6); }
        .threat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-6); }
        @media (max-width: 600px) { .threat-grid { grid-template-columns: 1fr; } }
        .threat-item { padding: var(--sp-5); border-radius: var(--rad-lg); }
        .threat-protected { background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2); }
        .threat-not-protected { background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); }
        .threat-header { font-weight: 600; margin-bottom: var(--sp-3); }
        .threat-item ul { list-style: none; }
        .threat-item li { font-size: 0.875rem; color: var(--clr-text-2); padding: var(--sp-1) 0; }
        .threat-item li::before { content: '→ '; color: var(--clr-text-3); }

        /* Fun */
        .fun-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--sp-5); }
        .fun-card { padding: var(--sp-8) var(--sp-6); text-align: center; transition: transform var(--tr-base); }
        .fun-card:hover { transform: translateY(-4px); }
        .fun-icon { font-size: 3rem; margin-bottom: var(--sp-4); display: block; }
        .fun-card h3 { margin-bottom: var(--sp-2); }

        /* CTA */
        .cta-banner { padding: var(--sp-8) 0; }
        .cta-content { padding: var(--sp-12) var(--sp-8); text-align: center; background: linear-gradient(135deg, rgba(99,102,241,0.15), rgba(6,182,212,0.1)); }
        .cta-content h2 { margin-bottom: var(--sp-4); }
        .cta-content p { margin-bottom: var(--sp-6); }

        /* PWA Install banner */
        .pwa-install-banner {
          display: flex; align-items: center; gap: var(--sp-3);
          margin-top: var(--sp-4); padding: 12px 18px;
          max-width: 420px; width: 100%;
          background: rgba(99,102,241,0.12);
          border: 1px solid rgba(99,102,241,0.35);
          border-radius: var(--rad-xl, 16px);
          cursor: pointer; text-align: left;
          transition: background 0.2s, border-color 0.2s;
          color: var(--clr-text);
          font-family: inherit;
          animation: toast-slide-in 0.4s ease;
        }
        .pwa-install-banner:hover { background: rgba(99,102,241,0.2); border-color: rgba(99,102,241,0.6); }
        .pwa-install-ios { cursor: default; background: rgba(251,191,36,0.08); border-color: rgba(251,191,36,0.35); }
        .pwa-install-ios:hover { background: rgba(251,191,36,0.12); border-color: rgba(251,191,36,0.5); }
        .pwa-install-icon { font-size: 1.5rem; flex-shrink: 0; }
        .pwa-install-text { display: flex; flex-direction: column; gap: 2px; flex: 1; }
        .pwa-install-text strong { font-size: 0.9rem; color: var(--clr-text); }
        .pwa-install-text span { font-size: 0.78rem; color: var(--clr-text-2); }
        .pwa-install-cta { font-size: 0.85rem; font-weight: 600; color: #a5b4fc; white-space: nowrap; flex-shrink: 0; }
        .cta-content h2 { margin-bottom: var(--sp-4); }
        .cta-content p { margin-bottom: var(--sp-6); }
      `}</style>
        </div>
    );
}
