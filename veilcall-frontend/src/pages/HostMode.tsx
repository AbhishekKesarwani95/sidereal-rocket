import { useNavigate } from 'react-router-dom';

export default function HostMode() {
    const navigate = useNavigate();

    return (
        <div className="page-wrapper" style={{ paddingTop: 'var(--sp-10)' }}>
            <div className="container" style={{ maxWidth: 580 }}>
                <h2 style={{ marginBottom: 'var(--sp-2)' }}>👑 <span className="grad-text">Host Mode</span></h2>
                <p style={{ marginBottom: 'var(--sp-8)' }}>
                    As a host, you control the room — set limits, manage participants, and keep the space safe.
                </p>

                <div className="host-cta glass-card">
                    <div style={{ fontSize: '3rem', marginBottom: 'var(--sp-4)' }}>🏗️</div>
                    <h3>Create a hosted room</h3>
                    <p style={{ marginBottom: 'var(--sp-5)' }}>
                        When you create a room, you automatically become the host. Host features activate once you're inside the call.
                    </p>
                    <button className="btn btn-primary" onClick={() => navigate('/create')}>
                        ✨ Create Room as Host
                    </button>
                </div>

                <div className="host-features glass-card" style={{ marginTop: 'var(--sp-5)' }}>
                    <h3 style={{ marginBottom: 'var(--sp-5)' }}>Host Controls (available in-call)</h3>
                    {[
                        { icon: '🔇', title: 'Mute All', desc: 'Silence all participants with one tap' },
                        { icon: '🚫', title: 'Remove Participant', desc: 'Remove disruptive members from the room' },
                        { icon: '🔒', title: 'Lock Room', desc: 'Prevent new participants from joining' },
                        { icon: '⏱️', title: 'Set Expiry', desc: 'Auto-close the room after a set time' },
                        { icon: '🛡️', title: 'Enforce Blur', desc: 'Require all participants to have blur enabled' },
                    ].map(f => (
                        <div key={f.title} style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'flex-start', marginBottom: 'var(--sp-4)', padding: 'var(--sp-3)', borderRadius: 'var(--rad-md)', background: 'var(--clr-surface)' }}>
                            <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>{f.icon}</span>
                            <div>
                                <div style={{ fontWeight: 600, fontFamily: 'var(--font-head)', marginBottom: 4 }}>{f.title}</div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--clr-text-3)' }}>{f.desc}</div>
                            </div>
                        </div>
                    ))}
                </div>

                <style>{`.host-cta { padding: var(--sp-8); text-align: center; margin-bottom: var(--sp-5); } .host-features { padding: var(--sp-6); }`}</style>
            </div>
        </div>
    );
}
