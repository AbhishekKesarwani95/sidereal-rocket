import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildShareLinks } from '../lib/roomCode';
import AdBanner from './AdBanner';

interface ShareModalProps {
    code: string;
    onClose: () => void;
}

const platforms = [
    { key: 'whatsapp', label: 'WhatsApp', icon: '💬', color: '#25D366' },
    { key: 'telegram', label: 'Telegram', icon: '✈️', color: '#0088cc' },
    { key: 'sms', label: 'SMS', icon: '📱', color: '#34C759' },
    { key: 'twitter', label: 'Twitter/X', icon: '🐦', color: '#1DA1F2' },
];

export default function ShareModal({ code, onClose }: ShareModalProps) {
    const [copied, setCopied] = useState(false);
    const links = buildShareLinks(code);
    const navigate = useNavigate();

    const copyToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(links.copy);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { }
    };

    const handleJoin = () => {
        onClose();
        navigate(`/room/${code}`);
    };

    return (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label="Share room">
            <div className="modal-box glass-card animate-fade-in-up">
                <div className="modal-header">
                    <h3>🔗 Room Created!</h3>
                    <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">✕</button>
                </div>

                <div className="room-code-display">
                    <p style={{ fontSize: '0.8rem', color: 'var(--clr-text-3)', marginBottom: 'var(--sp-2)' }}>Room Code</p>
                    <div className="code-box">
                        <span className="code-text">{code}</span>
                        <button className="btn btn-sm btn-secondary" onClick={copyToClipboard}>
                            {copied ? '✅ Copied!' : '📋 Copy Link'}
                        </button>
                    </div>
                </div>

                <p style={{ fontSize: '0.85rem', color: 'var(--clr-text-3)', margin: 'var(--sp-4) 0 var(--sp-3)' }}>
                    Share via:
                </p>
                <div className="share-grid">
                    {platforms.map(p => (
                        <a
                            key={p.key}
                            href={links[p.key as keyof typeof links]}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="share-btn"
                            style={{ '--share-color': p.color } as React.CSSProperties}
                        >
                            <span className="share-icon">{p.icon}</span>
                            <span>{p.label}</span>
                        </a>
                    ))}
                </div>

                <div style={{ margin: 'var(--sp-4) 0' }}>
                    <AdBanner variant="horizontal" label="Advertisement" />
                </div>

                <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleJoin}>
                    Enter Room →
                </button>
            </div>

            <style>{`
        .modal-backdrop {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.7);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          padding: var(--sp-4);
        }
        .modal-box { padding: var(--sp-6); max-width: 480px; width: 100%; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--sp-5); }
        .room-code-display {
          background: rgba(0,0,0,0.3);
          border: 1px solid var(--clr-border-2);
          border-radius: var(--rad-lg);
          padding: var(--sp-4);
        }
        .code-box { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
        .code-text { font-family: monospace; font-size: 1rem; color: var(--clr-accent); word-break: break-all; flex: 1; }
        .share-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
        .share-btn {
          display: flex; align-items: center; gap: var(--sp-2);
          padding: 10px 14px;
          background: color-mix(in srgb, var(--share-color) 15%, transparent);
          border: 1px solid color-mix(in srgb, var(--share-color) 30%, transparent);
          border-radius: var(--rad-md);
          color: var(--clr-text);
          font-size: 0.875rem;
          font-family: var(--font-head);
          font-weight: 500;
          text-decoration: none;
          transition: all var(--tr-fast);
        }
        .share-btn:hover { background: color-mix(in srgb, var(--share-color) 25%, transparent); transform: translateY(-1px); }
        .share-icon { font-size: 1.2rem; }
      `}</style>
        </div>
    );
}
