import React, { useState } from 'react';

export default function Profile() {
    const [displayName, setDisplayName] = useState(() => localStorage.getItem('vc_alias') || '');
    const [saved, setSaved] = useState(false);

    const save = (e: React.FormEvent) => {
        e.preventDefault();
        localStorage.setItem('vc_alias', displayName);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <div className="page-wrapper" style={{ paddingTop: 'var(--sp-10)' }}>
            <div className="container" style={{ maxWidth: 480 }}>
                <h2 style={{ marginBottom: 'var(--sp-2)' }}>👤 <span className="grad-text">Profile</span></h2>
                <p style={{ marginBottom: 'var(--sp-8)' }}>No account required. Your alias is stored only in your browser.</p>
                <form onSubmit={save} className="glass-card" style={{ padding: 'var(--sp-6)' }}>
                    <div style={{ marginBottom: 'var(--sp-5)' }}>
                        <label htmlFor="alias" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--clr-text-2)', marginBottom: 'var(--sp-2)' }}>Display Alias</label>
                        <input id="alias" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. VeiledStar, MysticUser" maxLength={20} />
                    </div>
                    <button type="submit" className={`btn ${saved ? 'btn-secondary' : 'btn-primary'}`} style={{ width: '100%' }}>
                        {saved ? '✅ Saved!' : '💾 Save Alias'}
                    </button>
                </form>
                <div className="glass-card" style={{ padding: 'var(--sp-5)', marginTop: 'var(--sp-5)' }}>
                    <h3 style={{ marginBottom: 'var(--sp-3)' }}>🔐 Privacy Info</h3>
                    <p style={{ fontSize: '0.875rem' }}>Your alias is stored only in localStorage on this device. No account, no email, no server-side profile. The only data we hold server-side is an in-memory room list cleared when rooms close.</p>
                </div>
            </div>
        </div>
    );
}
