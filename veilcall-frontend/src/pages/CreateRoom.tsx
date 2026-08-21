import React, { useState } from 'react';
import ShareModal from '../components/ShareModal';
import AdBanner from '../components/AdBanner';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export default function CreateRoom() {
    const [maxPeople, setMaxPeople] = useState(6);
    const [expiry, setExpiry] = useState('');
    const [isPublic, setIsPublic] = useState(false);
    const [interests, setInterests] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [createdCode, setCreatedCode] = useState('');

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const body: Record<string, unknown> = { maxParticipants: maxPeople, isPublic };
            if (expiry) body.expirySecs = Number(expiry) * 60;
            if (interests) body.interests = interests.split(',').map(s => s.trim()).filter(Boolean);

            const res = await fetch(`${API_BASE}/api/rooms`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to create room');
            setCreatedCode(data.code);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Something went wrong');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="page-wrapper create-room-page">
            <div className="container" style={{ maxWidth: 540, paddingTop: 'var(--sp-12)' }}>
                <div className="page-back">
                    <a href="/" className="btn btn-ghost btn-sm">← Back</a>
                </div>

                <h2 style={{ margin: 'var(--sp-6) 0 var(--sp-2)' }}>
                    ✨ <span className="grad-text">Create a Room</span>
                </h2>
                <p style={{ marginBottom: 'var(--sp-8)' }}>
                    A unique, unguessable room code will be generated. Share it with anyone you want to call.
                </p>

                <form onSubmit={handleCreate} className="glass-card create-form">
                    <div className="form-group">
                        <label htmlFor="max-people">Max Participants</label>
                        <div className="slider-row">
                            <input
                                id="max-people"
                                type="range"
                                min={2}
                                max={12}
                                value={maxPeople}
                                onChange={e => setMaxPeople(Number(e.target.value))}
                            />
                            <span className="slider-val">{maxPeople}</span>
                        </div>
                    </div>

                    <div className="form-group">
                        <label htmlFor="expiry">Auto-expire after (minutes, leave blank = 24h)</label>
                        <input
                            id="expiry"
                            type="number"
                            min={5}
                            max={1440}
                            placeholder="e.g. 60"
                            value={expiry}
                            onChange={e => setExpiry(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                checked={isPublic}
                                onChange={e => setIsPublic(e.target.checked)}
                                id="is-public"
                            />
                            <span>List in Random Call discovery</span>
                        </label>
                    </div>

                    {isPublic && (
                        <div className="form-group">
                            <label htmlFor="interests">Interests (comma-separated, for matching)</label>
                            <input
                                id="interests"
                                type="text"
                                placeholder="e.g. music, gaming, movies"
                                value={interests}
                                onChange={e => setInterests(e.target.value)}
                            />
                        </div>
                    )}

                    {error && (
                        <div className="error-box" role="alert">⚠️ {error}</div>
                    )}

                    <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', marginTop: 'var(--sp-2)' }}>
                        {loading ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Creating…</> : '✨ Create Room'}
                    </button>
                </form>

                <div style={{ marginTop: 'var(--sp-8)' }}>
                    <AdBanner variant="horizontal" label="Advertisement" />
                </div>
            </div>

            {createdCode && (
                <ShareModal code={createdCode} onClose={() => setCreatedCode('')} />
            )}

            <style>{`
        .create-room-page { min-height: 100dvh; }
        .create-form { padding: var(--sp-8); }
        .form-group { margin-bottom: var(--sp-5); }
        .form-group label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: var(--sp-2); color: var(--clr-text-2); }
        .slider-row { display: flex; align-items: center; gap: var(--sp-4); }
        .slider-row input[type="range"] { flex: 1; }
        .slider-val { font-family: var(--font-head); font-size: 1.1rem; font-weight: 700; color: var(--clr-primary-light); min-width: 28px; text-align: center; }
        .checkbox-label { display: flex !important; align-items: center; gap: var(--sp-3); cursor: pointer; font-size: 0.9rem !important; color: var(--clr-text) !important; }
        .checkbox-label input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--clr-primary); cursor: pointer; }
        .error-box { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: var(--rad-md); padding: var(--sp-3) var(--sp-4); font-size: 0.875rem; color: var(--clr-danger-light); margin-bottom: var(--sp-4); }
        .page-back { margin-bottom: var(--sp-4); }
      `}</style>
        </div>
    );
}
