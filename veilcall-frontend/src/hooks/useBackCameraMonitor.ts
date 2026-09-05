/**
 * useBackCameraMonitor
 *
 * Opens the rear-facing (environment) camera as a silent secondary stream and
 * analyzes frames for signs of external recording devices:
 *
 *   1. Bright rectangular screen glow — a phone/tablet screen produces a large,
 *      very bright rectangular region. We measure mean luminance and detect
 *      significant bright blobs.
 *
 *   2. IR emitter flash — many recording devices (including pen cameras) emit
 *      IR bursts. On cameras that can see near-IR this shows as brief white
 *      flashes. We watch for sudden luminance spikes between frames.
 *
 *   3. Reflective lens glint — a small, very high-luminance point (~99th
 *      percentile brightness) that moves slightly frame-to-frame is consistent
 *      with light reflecting off a camera lens.
 *
 * Analysis runs at 2 fps (every 500 ms) to minimize battery drain.
 *
 * NOTE: On iOS Safari only ONE camera can be active at a time.
 * On iOS we degrade gracefully — the monitor is dormant and returns
 * { supported: false }.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface BackCameraState {
    supported: boolean;
    monitoring: boolean;
    threatDetected: boolean;
    threatLevel: 'none' | 'low' | 'high';
    /** Human-readable reason for the threat (for logging/debugging) */
    threatReason: string;
}

const INITIAL_STATE: BackCameraState = {
    supported: false,
    monitoring: false,
    threatDetected: false,
    threatLevel: 'none',
    threatReason: '',
};

/** How long to keep the threat alert active after last signal (ms). */
const THREAT_DURATION_MS = 8_000;

/** Analysis interval (ms). Low fps to save battery. */
const ANALYSIS_INTERVAL_MS = 500;

/** Luminance threshold: pixel is "bright" if value > this (0-255). */
const BRIGHT_THRESHOLD = 200;

/** Frame-to-frame luminance spike threshold (fraction of max 255). */
const SPIKE_THRESHOLD = 0.18;

/** Fraction of frame that must be bright to flag screen glow. */
const SCREEN_GLOW_FRACTION = 0.12;

// ── Low-level frame analysis ─────────────────────────────────────────────────

interface FrameStats {
    meanLuminance: number;
    brightFraction: number;   // 0-1
    maxLuminance: number;
}

function analyzeFrame(ctx: CanvasRenderingContext2D, w: number, h: number): FrameStats {
    // Sample every 4th pixel for performance
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    let sum = 0, bright = 0, max = 0;
    const stride = 4 * 4; // skip 3 pixels each step
    const count = Math.floor(data.length / stride);

    for (let i = 0; i < data.length; i += stride) {
        // Rec. 709 luminance
        const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        sum += luma;
        if (luma > BRIGHT_THRESHOLD) bright++;
        if (luma > max) max = luma;
    }

    return {
        meanLuminance: sum / count,
        brightFraction: bright / count,
        maxLuminance: max,
    };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useBackCameraMonitor() {
    const [state, setState] = useState<BackCameraState>(INITIAL_STATE);

    const streamRef = useRef<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevLumaRef = useRef<number | null>(null);
    const activeRef = useRef(false);

    const triggerThreat = useCallback((level: 'low' | 'high', reason: string) => {
        setState(s => ({ ...s, threatDetected: true, threatLevel: level, threatReason: reason }));
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => {
            setState(s => ({ ...s, threatDetected: false, threatLevel: 'none', threatReason: '' }));
        }, THREAT_DURATION_MS);
    }, []);

    const stop = useCallback(() => {
        activeRef.current = false;
        if (timerRef.current) clearInterval(timerRef.current);
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setState(s => ({ ...s, monitoring: false }));
    }, []);

    const start = useCallback(async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            setState({ ...INITIAL_STATE, supported: false });
            return;
        }

        // iOS Safari: only one camera active at a time — skip gracefully
        const ua = navigator.userAgent;
        const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;
        if (isIOS) {
            setState({ ...INITIAL_STATE, supported: false });
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { exact: 'environment' },
                    width: { ideal: 320 },   // low res — only need analysis
                    height: { ideal: 240 },
                    frameRate: { ideal: 4 },  // ultra low fps
                },
            });
            streamRef.current = stream;

            // Create hidden video element for frame grabbing
            const video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            video.playsInline = true;
            video.style.display = 'none';
            document.body.appendChild(video);
            await video.play();
            videoRef.current = video;

            // Create hidden analysis canvas
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 240;
            canvasRef.current = canvas;

            activeRef.current = true;
            setState({ supported: true, monitoring: true, threatDetected: false, threatLevel: 'none', threatReason: '' });

            // Analysis loop
            timerRef.current = setInterval(() => {
                if (!activeRef.current) return;
                const v = videoRef.current;
                const c = canvasRef.current;
                if (!v || !c || v.readyState < 2) return;

                const ctx = c.getContext('2d');
                if (!ctx) return;

                ctx.drawImage(v, 0, 0, c.width, c.height);
                const stats = analyzeFrame(ctx, c.width, c.height);

                // ── Detection rules ───────────────────────────────────────────

                // 1. Screen glow: large bright area = phone/tablet screen nearby
                if (stats.brightFraction > SCREEN_GLOW_FRACTION) {
                    triggerThreat('high', 'Bright screen detected nearby (possible recording device)');
                    prevLumaRef.current = stats.meanLuminance;
                    return;
                }

                // 2. IR spike: sudden mean luminance jump between frames
                if (prevLumaRef.current !== null) {
                    const spike = Math.abs(stats.meanLuminance - prevLumaRef.current) / 255;
                    if (spike > SPIKE_THRESHOLD) {
                        triggerThreat('high', 'Sudden light flash detected (possible IR emitter or camera shutter)');
                        prevLumaRef.current = stats.meanLuminance;
                        return;
                    }
                }

                // 3. Glint: very high max luminance with low mean = isolated bright point (lens)
                if (stats.maxLuminance > 250 && stats.meanLuminance < 80) {
                    triggerThreat('low', 'Reflective glint detected (possible camera lens)');
                }

                prevLumaRef.current = stats.meanLuminance;
            }, ANALYSIS_INTERVAL_MS);

        } catch {
            // Back camera unavailable (permission denied or not present)
            setState({ ...INITIAL_STATE, supported: false });
        }
    }, [triggerThreat]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stop();
            if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
            // Remove hidden video element
            if (videoRef.current) {
                videoRef.current.remove();
                videoRef.current = null;
            }
        };
    }, [stop]);

    return { ...state, start, stop };
}
