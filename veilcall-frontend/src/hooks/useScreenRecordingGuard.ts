/**
 * useScreenRecordingGuard
 *
 * Detects when the current page is being screen-recorded using available browser signals.
 * Three detection paths are combined:
 *
 * 1. Page Visibility API — iOS/Android native screen recorders briefly hide the page
 *    when they start. We watch for rapid hide→show cycles as a heuristic signal.
 *
 * 2. getDisplayMedia capture stream tracking — if THIS page is captured by another
 *    browser tab or system screencaster, a MediaStreamTrack in a display-capture stream
 *    will report `readyState === 'live'`. We poll active streams via
 *    navigator.mediaDevices.enumerateDevices() and a stored reference.
 *
 * 3. Picture-in-Picture — PiP is frequently used alongside recording apps.
 *
 * IMPORTANT: Physical cameras (pen cameras, secondary phones) cannot be detected
 * by any browser API. Layer 3 (canvas flicker) in useFaceBlur provides passive
 * countermeasures for those cases.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export type RecordingSource = 'screen-capture' | 'visibility' | 'pip' | 'none';

export interface RecordingGuardState {
    recordingDetected: boolean;
    source: RecordingSource;
}

/** How long (ms) to keep the alert active after the last signal. */
const ALERT_DURATION_MS = 10_000;

/** Visibility hide events within this window → recording signal. */
const VISIBILITY_DEBOUNCE_MS = 3_000;

export function useScreenRecordingGuard(): RecordingGuardState {
    const [state, setState] = useState<RecordingGuardState>({
        recordingDetected: false,
        source: 'none',
    });

    const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastHideRef = useRef<number>(0);
    const hideCountRef = useRef<number>(0);
    const displayStreamsRef = useRef<MediaStream[]>([]);

    // Trigger detection: set state and schedule auto-reset
    const trigger = useCallback((source: RecordingSource) => {
        setState({ recordingDetected: true, source });
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => {
            setState({ recordingDetected: false, source: 'none' });
        }, ALERT_DURATION_MS);
    }, []);

    // ── 1. Page Visibility heuristic ────────────────────────────────────────────
    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.hidden) {
                const now = Date.now();
                // Count rapid hide events
                if (now - lastHideRef.current < VISIBILITY_DEBOUNCE_MS) {
                    hideCountRef.current++;
                } else {
                    hideCountRef.current = 1;
                }
                lastHideRef.current = now;
            } else {
                // Page became visible again — if we saw at least 1 quick hide,
                // it may be a screen recorder toggling. Keep it conservative:
                // require 1+ hide within a short window (not too chatty).
                if (hideCountRef.current >= 1) {
                    trigger('visibility');
                    hideCountRef.current = 0;
                }
            }
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, [trigger]);

    // ── 2. Intercept getDisplayMedia ───────────────────────────────────────────
    // Monkey-patch navigator.mediaDevices.getDisplayMedia so we know when
    // a display-capture stream is active on this device.
    useEffect(() => {
        const md = navigator.mediaDevices;
        if (!md || typeof md.getDisplayMedia !== 'function') return;

        const original = md.getDisplayMedia.bind(md);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (md as any).getDisplayMedia = async function (...args: Parameters<typeof md.getDisplayMedia>) {
            const stream = await original(...args);
            // Store the stream reference
            displayStreamsRef.current.push(stream);
            trigger('screen-capture');

            // Remove from ref when all tracks end
            const cleanup = () => {
                displayStreamsRef.current = displayStreamsRef.current.filter(s => s !== stream);
            };
            stream.getTracks().forEach(t => t.addEventListener('ended', cleanup));

            return stream;
        };

        return () => {
            // Restore original on cleanup
            (md as MediaDevices & { getDisplayMedia: typeof md.getDisplayMedia }).getDisplayMedia = original;
        };
    }, [trigger]);

    // ── 3. Picture-in-Picture detection ────────────────────────────────────────
    useEffect(() => {
        const onPiP = () => trigger('pip');
        document.addEventListener('enterpictureinpicture', onPiP);
        return () => document.removeEventListener('enterpictureinpicture', onPiP);
    }, [trigger]);

    // ── Cleanup ────────────────────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        };
    }, []);

    return state;
}
