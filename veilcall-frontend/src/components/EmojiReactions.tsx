import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ReactionEvent {
    id: string;
    from: string;
    emoji: string;
    ts: number;
}

const EMOJIS = ['👍', '❤️', '😂', '🔥', '👏', '🎉', '😮', '💯'];
const REACTION_TTL_MS = 3500;

// ── Particle: a single emoji that spawns at click position and flies to top ──
interface Particle {
    id: string;
    emoji: string;
    // Spawn position relative to viewport (px)
    x: number;
    y: number;
    // Randomised per-particle variation
    dx: number;     // horizontal drift (px)
    size: number;   // font-size (px)
    dur: number;    // animation duration (ms)
}


// Global layer — portalled to document.body to escape any ancestor stacking context
// (backdrop-filter / transform on Room containers would clip position:fixed otherwise)
function ParticleLayer({ particles }: { particles: Particle[] }) {
    if (particles.length === 0) return null;
    return createPortal(
        <div
            aria-hidden="true"
            style={{
                position: 'fixed', inset: 0, pointerEvents: 'none',
                zIndex: 99999, overflow: 'visible',
            }}
        >
            {particles.map(p => (
                <div
                    key={p.id}
                    style={{
                        position: 'absolute',
                        left: p.x,
                        top: p.y,
                        fontSize: p.size,
                        lineHeight: 1,
                        userSelect: 'none',
                        // --drift: horizontal sway; --rise: full viewport height so emoji reaches y=0
                        ['--drift' as string]: `${p.dx}px`,
                        ['--rise' as string]: `${p.y + 60}px`,
                        animation: `emoji-fly-up ${p.dur}ms cubic-bezier(0.22,1,0.36,1) forwards`,
                        willChange: 'transform, opacity',
                    }}
                >
                    {p.emoji}
                </div>
            ))}
            <style>{`
                @keyframes emoji-fly-up {
                    0%   { transform: translate(0, 0) scale(1.5); opacity: 1; }
                    20%  { opacity: 1; }
                    80%  { transform: translate(var(--drift), calc(var(--rise) * -0.9)) scale(0.9); opacity: 0.7; }
                    100% { transform: translate(calc(var(--drift) * 1.1), calc(var(--rise) * -1.05)) scale(0.5); opacity: 0; }
                }
            `}</style>
        </div>,
        document.body
    );
}

// ── EmojiReactions ─────────────────────────────────────────────────────────────
interface Props {
    reactions: ReactionEvent[];
    onReact: (emoji: string) => void;
}

export default function EmojiReactions({ reactions, onReact }: Props) {
    const [open, setOpen] = useState(false);
    const [particles, setParticles] = useState<Particle[]>([]);
    const trayRef = useRef<HTMLDivElement>(null);

    // When a new reaction arrives (from remote or local), spawn a burst of particles
    const latestReactionId = useRef<string>('');
    useEffect(() => {
        if (reactions.length === 0) return;
        const latest = reactions[reactions.length - 1];
        if (latest.id === latestReactionId.current) return;
        latestReactionId.current = latest.id;

        // Spawn 3 particles per reaction with slight variation
        const COUNT = 3;
        const newParticles: Particle[] = [];

        // Use the tray button position as spawn point, or centre-bottom as fallback
        const anchor = trayRef.current?.getBoundingClientRect();
        const spawnX = anchor ? anchor.left + anchor.width / 2 - 20 : window.innerWidth / 2 - 20;
        const spawnY = anchor ? anchor.top - 10 : window.innerHeight - 120;

        for (let i = 0; i < COUNT; i++) {
            newParticles.push({
                id: `${latest.id}-${i}`,
                emoji: latest.emoji,
                x: spawnX + (Math.random() - 0.5) * 40,
                y: spawnY + (Math.random() - 0.5) * 20,
                dx: (Math.random() - 0.5) * 120,
                size: 28 + Math.random() * 20,     // 28–48px
                dur: REACTION_TTL_MS - 300 + Math.random() * 600,
            });
        }

        setParticles(prev => [...prev, ...newParticles]);

        // Remove after animation finishes
        const maxDur = Math.max(...newParticles.map(p => p.dur));
        const ids = new Set(newParticles.map(p => p.id));
        setTimeout(() => setParticles(prev => prev.filter(p => !ids.has(p.id))), maxDur + 50);
    }, [reactions]);

    const handleReact = useCallback((emoji: string) => {
        onReact(emoji);
        setOpen(false);
    }, [onReact]);

    return (
        <>
            <ParticleLayer particles={particles} />

            {/* Picker tray + toggle button */}
            <div className="reaction-tray-wrapper" ref={trayRef}>
                {open && (
                    <div className="emoji-picker-tray" role="toolbar" aria-label="Emoji reactions">
                        {EMOJIS.map(e => (
                            <button
                                key={e}
                                className="emoji-pick-btn"
                                onClick={() => handleReact(e)}
                                aria-label={`React with ${e}`}
                            >
                                {e}
                            </button>
                        ))}
                    </div>
                )}
                <button
                    className={`ctrl-btn${open ? ' active' : ''}`}
                    onClick={() => setOpen(o => !o)}
                    title="Reactions (R)"
                    aria-label="Toggle reactions"
                >
                    😊<span>React</span>
                </button>
            </div>
        </>
    );
}
