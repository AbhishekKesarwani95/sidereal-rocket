import React, { useEffect, useRef, useState } from 'react';

export interface ReactionEvent {
    id: string;
    from: string;
    emoji: string;
    ts: number;
}

const EMOJIS = ['👍', '❤️', '😂', '🔥', '👏', '🎉', '😮', '💯'];
const REACTION_TTL_MS = 3200;

// ── FloatingEmoji ─────────────────────────────────────────────────────────────
function FloatingEmoji({ emoji, left }: { emoji: string; left: number }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const t = setTimeout(() => { el.style.opacity = '0'; }, REACTION_TTL_MS - 400);
        return () => clearTimeout(t);
    }, []);
    return (
        <div ref={ref} className="floating-emoji" style={{ left: `${left}%` }} aria-hidden="true">
            {emoji}
        </div>
    );
}

// ── EmojiReactions ────────────────────────────────────────────────────────────
interface Props {
    reactions: ReactionEvent[];
    onReact: (emoji: string) => void;
}

export default function EmojiReactions({ reactions, onReact }: Props) {
    const [open, setOpen] = useState(false);
    const lefts = useRef<Map<string, number>>(new Map());

    // Assign stable random horizontal positions per reaction ID
    reactions.forEach(r => {
        if (!lefts.current.has(r.id)) {
            lefts.current.set(r.id, 8 + Math.random() * 82);
        }
    });

    // Clean up old position entries
    useEffect(() => {
        const ids = new Set(reactions.map(r => r.id));
        lefts.current.forEach((_, id) => { if (!ids.has(id)) lefts.current.delete(id); });
    }, [reactions]);

    return (
        <>
            {/* Floating emoji layer — rendered in the video area */}
            <div className="floating-emoji-layer" aria-live="polite">
                {reactions.map(r => (
                    <FloatingEmoji key={r.id} emoji={r.emoji} left={lefts.current.get(r.id) ?? 50} />
                ))}
            </div>

            {/* Picker tray + toggle button */}
            <div className="reaction-tray-wrapper">
                {open && (
                    <div className="emoji-picker-tray" role="toolbar" aria-label="Emoji reactions">
                        {EMOJIS.map(e => (
                            <button
                                key={e}
                                className="emoji-pick-btn"
                                onClick={() => { onReact(e); setOpen(false); }}
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
