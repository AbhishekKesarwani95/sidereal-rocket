import { useState, useEffect, useRef, useCallback } from 'react';
import { type NetworkTier } from './useNetworkTier';

export type BlurMode = 'gaussian' | 'pixelate' | 'mask';

export interface BlurOptions {
    enabled: boolean;
    mode: BlurMode;
    strength: number; // 1–20
    padding: number;  // extra px around detected face box
}

export const DEFAULT_BLUR_OPTIONS: BlurOptions = {
    enabled: true,
    mode: 'gaussian',
    strength: 18,
    padding: 85,
};

/**
 * When a face bbox width is smaller than this fraction of the canvas,
 * the user is far from the camera — scale up padding so the blur region
 * still covers the full face (including hair/ears at distance).
 */
const FAR_FACE_THRESHOLD = 0.15; // face < 15% of canvas width → "far"
const FAR_FACE_PADDING_SCALE = 1.8; // multiply padding by this when far

/** Resolution constraints per network tier */
const TIER_CAMERA: Record<NetworkTier, { width: number; height: number }> = {
    low: { width: 640, height: 480 },
    mid: { width: 1280, height: 720 },
    high: { width: 1280, height: 720 },
};

/** captureStream fps per tier */
const TIER_FPS: Record<NetworkTier, number> = {
    low: 12,
    mid: 20,
    high: 30,
};

/** Face detection interval per tier (ms) */
const TIER_DETECTION_MS: Record<NetworkTier, number> = {
    low: 0,    // skip ML detection on low — use motion centroid only
    mid: 66,   // ~15 Hz detection
    high: 33,  // ~30 Hz detection — matches typical RAF rate
};

// Low-fidelity face box for smoothing
interface FaceBox { x: number; y: number; w: number; h: number; }

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function lerpBox(a: FaceBox, b: FaceBox, t: number): FaceBox {
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}

function applyBlurToRegion(
    ctx: CanvasRenderingContext2D,
    box: FaceBox,
    mode: BlurMode,
    strength: number,
    padding: number,
    canvasWidth: number
) {
    const { x, y, w, h } = box;
    // Adaptive padding: boost when face is far (small in frame)
    const isFarFace = canvasWidth > 0 && (w / canvasWidth) < FAR_FACE_THRESHOLD;
    const effectivePadding = isFarFace ? padding * FAR_FACE_PADDING_SCALE : padding;

    const px = Math.max(0, x - effectivePadding);
    const py = Math.max(0, y - effectivePadding);
    const pw = w + effectivePadding * 2;
    const ph = h + effectivePadding * 2;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(px + pw / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2);
    ctx.clip();

    if (mode === 'gaussian') {
        ctx.filter = `blur(${strength}px)`;
        ctx.drawImage(ctx.canvas, px, py, pw, ph, px, py, pw, ph);
        ctx.filter = 'none';
    } else if (mode === 'pixelate') {
        const pixel = Math.max(4, strength * 2);
        const tmp = document.createElement('canvas');
        tmp.width = Math.max(1, Math.floor(pw / pixel));
        tmp.height = Math.max(1, Math.floor(ph / pixel));
        const tc = tmp.getContext('2d')!;
        tc.drawImage(ctx.canvas, px, py, pw, ph, 0, 0, tmp.width, tmp.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, px, py, pw, ph);
        ctx.imageSmoothingEnabled = true;
    } else if (mode === 'mask') {
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(px, py, pw, ph);
    }
    ctx.restore();
}

/** Blur the entire canvas (used for forceFullBlur / screen-recording-detected mode). */
function applyFullFrameBlur(ctx: CanvasRenderingContext2D, strength: number) {
    ctx.save();
    ctx.filter = `blur(${strength}px)`;
    ctx.drawImage(ctx.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.filter = 'none';
    ctx.restore();
}

export function useFaceBlur(
    options: BlurOptions,
    networkTier: NetworkTier = 'high',
    forceFullBlur = false
) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const detectorRef = useRef<unknown>(null);
    const smoothedBoxesRef = useRef<FaceBox[]>([]);
    const animFrameRef = useRef<number>(0);
    const detectionIntervalRef = useRef<number>(0);
    const lastDetectedRef = useRef<FaceBox[]>([]);
    const optionsRef = useRef(options);
    const renderingRef = useRef(false);
    const forceFullBlurRef = useRef(forceFullBlur);
    optionsRef.current = options;

    // Track which camera is active ('user' = front, 'environment' = back)
    const [activeFacingMode, setActiveFacingMode] = useState<'user' | 'environment'>('user');
    const activeFacingModeRef = useRef<'user' | 'environment'>('user');

    // Sync refs on every render
    useEffect(() => { optionsRef.current = options; }, [options]);
    useEffect(() => { networkTierRef.current = networkTier; }, [networkTier]);
    useEffect(() => { forceFullBlurRef.current = forceFullBlur; }, [forceFullBlur]);

    const networkTierRef = useRef<NetworkTier>(networkTier);

    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [facesDetected, setFacesDetected] = useState(0);
    const [cameraEnabled, setCameraEnabledState] = useState(true);
    // Exposed as state so consumers can react when the stream becomes available
    const [blurredStreamState, setBlurredStreamState] = useState<MediaStream | null>(null);

    const blurredStream = useRef<MediaStream | null>(null);

    const initCamera = useCallback(async (deviceId?: string, facingMode?: 'user' | 'environment') => {
        // navigator.mediaDevices is undefined on plain HTTP in mobile browsers
        if (!navigator.mediaDevices?.getUserMedia) {
            setError('Camera unavailable: please use HTTPS or localhost.');
            return null;
        }
        try {
            const tier = networkTierRef.current;
            const res = TIER_CAMERA[tier];
            const facing = facingMode ?? activeFacingModeRef.current;
            const constraints: MediaStreamConstraints = {
                video: deviceId
                    ? { deviceId: { exact: deviceId }, width: { ideal: res.width }, height: { ideal: res.height } }
                    : { facingMode: facing, width: { ideal: res.width }, height: { ideal: res.height } },
                audio: false,
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;
            // Update facing mode state
            activeFacingModeRef.current = facing;
            setActiveFacingMode(facing);
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
            setError(null);
            return stream;
        } catch (e: unknown) {
            const err = e instanceof Error ? e.message : 'Camera access denied';
            setError(err.includes('Permission') || err.includes('NotAllowed') ? 'Camera permission denied. Please allow camera access and reload.' : err);
            return null;
        }
    }, []);

    const initDetector = useCallback(async () => {
        try {
            const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
            const vision = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
            );
            const detector = await FaceDetector.createFromOptions(vision, {
                baseOptions: {
                    // Full-range model: detects faces from ~10 cm to ~5 m distance
                    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite',
                    delegate: 'GPU',
                },
                runningMode: 'VIDEO',
                // Lower threshold (0.3 vs 0.5) to catch far-away / partially visible faces
                minDetectionConfidence: 0.3,
            });
            detectorRef.current = detector;
        } catch (e) {
            console.warn('Face detector init failed, blur mode will still work with full-frame effect', e);
        }
    }, []);

    const startRendering = useCallback(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;

        const ctx = canvas.getContext('2d')!;
        let lastDetectionTime = 0;
        // Motion-adaptive: halve the interval when motion detected
        let motionDetected = false;
        let prevFrameData: ImageData | null = null;
        // Tiny off-screen canvas for pixel-diff motion detection (16×9)
        const motionCanvas = document.createElement('canvas');
        motionCanvas.width = 16;
        motionCanvas.height = 9;
        const mCtx = motionCanvas.getContext('2d', { willReadFrequently: true })!;
        const MOTION_THRESHOLD = 12; // lower threshold = more sensitive to movement

        function detectMotion(): boolean {
            mCtx.drawImage(video!, 0, 0, 16, 9);
            const curr = mCtx.getImageData(0, 0, 16, 9);
            if (!prevFrameData) { prevFrameData = curr; return false; }
            let diff = 0;
            for (let i = 0; i < curr.data.length; i += 4) {
                diff += Math.abs(curr.data[i] - prevFrameData.data[i])
                    + Math.abs(curr.data[i + 1] - prevFrameData.data[i + 1])
                    + Math.abs(curr.data[i + 2] - prevFrameData.data[i + 2]);
            }
            prevFrameData = curr;
            const avgDiff = diff / (16 * 9 * 3);
            return avgDiff > MOTION_THRESHOLD;
        }

        /**
         * Compute a motion-weighted centroid from the low-res motion canvas.
         * Returns a FaceBox centred on the area of most activity, scaled to canvas coords.
         * Used as a moving fallback when the ML detector hasn't loaded yet.
         */
        function getMotionCentroidBox(cw: number, ch: number): FaceBox {
            if (!prevFrameData) {
                return { x: cw * 0.2, y: ch * 0.02, w: cw * 0.6, h: ch * 0.65 };
            }
            const curr = mCtx.getImageData(0, 0, 16, 9);
            let totalW = 0, cx = 0, cy = 0;
            for (let py = 0; py < 9; py++) {
                for (let px = 0; px < 16; px++) {
                    const i = (py * 16 + px) * 4;
                    const w = Math.abs(curr.data[i] - prevFrameData!.data[i])
                        + Math.abs(curr.data[i + 1] - prevFrameData!.data[i + 1])
                        + Math.abs(curr.data[i + 2] - prevFrameData!.data[i + 2]);
                    cx += px * w;
                    cy += py * w;
                    totalW += w;
                }
            }
            if (totalW < 1) return { x: cw * 0.2, y: ch * 0.02, w: cw * 0.6, h: ch * 0.65 };
            const nx = (cx / totalW) / 15;
            const ny = (cy / totalW) / 8;
            const bw = cw * 0.55;
            const bh = ch * 0.65;
            return {
                x: Math.max(0, nx * cw - bw / 2),
                y: Math.max(0, ny * ch - bh / 2),
                w: bw,
                h: bh,
            };
        }

        let noDetectionFrames = 0; // frames since last successful ML face detection
        const NO_DETECTION_EXPIRE = 5; // dissolve stale box after ~160ms at 30fps

        // Velocity tracking for adaptive lerp
        // When the detected box is moving fast we snap to it (lerpT→1)
        // When stationary we use a medium-smoothing factor
        let prevDetected: FaceBox | null = null;
        let velocityMag = 0; // normalised 0-1 per canvas dimension per frame

        let flickerFrame = 0; // for anti-camera flicker shield

        const renderFrame = (ts: number) => {
            if (!video.videoWidth) { animFrameRef.current = requestAnimationFrame(renderFrame); return; }
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // ── Anti-physical-camera flicker shield ───────────────────────────
            flickerFrame++;
            if (flickerFrame % 2 === 1) {
                ctx.fillStyle = 'rgba(255,255,255,0.07)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            const opts = optionsRef.current;

            // ── forceFullBlur: triggered by screen recording detection ────────
            if (forceFullBlurRef.current) {
                applyFullFrameBlur(ctx, 30);
                animFrameRef.current = requestAnimationFrame(renderFrame);
                return;
            }

            // ── Motion-adaptive detection interval ────────────────────────────
            // Check motion every 3 frames — fast enough to react within 100ms
            if (flickerFrame % 3 === 0) {
                motionDetected = detectMotion();
            }
            const BASE_INTERVAL = TIER_DETECTION_MS[networkTierRef.current];
            // When motion detected: run detection at FULL rate (BASE_INTERVAL)
            // When idle: allow up to 2× interval (saves CPU without visible lag)
            const DETECTION_INTERVAL = motionDetected ? BASE_INTERVAL : Math.min(BASE_INTERVAL * 2, 150);

            // On low tier, skip ML face detection entirely — use center-region fallback
            const useMlDetection = TIER_DETECTION_MS[networkTierRef.current] > 0;
            if (opts.enabled && useMlDetection && detectorRef.current) {
                // Run detection at adaptive rate
                if (ts - lastDetectionTime > DETECTION_INTERVAL && video.readyState >= 2) {
                    lastDetectionTime = ts;
                    try {
                        const detector = detectorRef.current as { detectForVideo: (v: HTMLVideoElement, ts: number) => { detections: Array<{ boundingBox: { originX: number; originY: number; width: number; height: number } }> } };
                        const result = detector.detectForVideo(video, ts);
                        lastDetectedRef.current = result.detections.map(d => ({
                            x: d.boundingBox.originX,
                            y: d.boundingBox.originY,
                            w: d.boundingBox.width,
                            h: d.boundingBox.height,
                        }));
                        setFacesDetected(result.detections.length);
                    } catch { }
                }

                // Smooth and apply blur per detected face
                const detected = lastDetectedRef.current;

                // Stale-box expiry: count consecutive frames with no detections
                if (detected.length === 0) {
                    noDetectionFrames++;
                } else {
                    noDetectionFrames = 0;

                    // ── Velocity-based adaptive lerp ─────────────────────────────
                    // Measure how much the first detected face moved since last frame.
                    // If fast → snap instantly (lerpT→1); if slow → smooth (lerpT→0.65)
                    if (prevDetected && detected[0]) {
                        const dx = (detected[0].x - prevDetected.x) / (canvas.width || 640);
                        const dy = (detected[0].y - prevDetected.y) / (canvas.height || 480);
                        velocityMag = Math.sqrt(dx * dx + dy * dy);
                    }
                    if (detected[0]) prevDetected = { ...detected[0] };
                }
                // After enough frames with no detection, dissolve the blur region
                if (noDetectionFrames > NO_DETECTION_EXPIRE) {
                    smoothedBoxesRef.current = [];
                }

                while (smoothedBoxesRef.current.length < detected.length) {
                    smoothedBoxesRef.current.push({ ...detected[smoothedBoxesRef.current.length] });
                }
                smoothedBoxesRef.current = smoothedBoxesRef.current.slice(0, detected.length);

                // Motion-responsive smoothing:
                //   - velocity-based: clamp(velocity * 80, 0.65, 0.98) when moving
                //   - idle: 0.65 — smoother than before (was 0.3) but still fast
                //   - motion sensor fallback: 0.9 when pixel-motion detected
                const velocityLerp = Math.min(0.98, 0.65 + velocityMag * 80);
                const lerpT = detected.length > 0
                    ? (motionDetected ? Math.max(velocityLerp, 0.9) : 0.65)
                    : 0;
                for (let i = 0; i < detected.length; i++) {
                    smoothedBoxesRef.current[i] = lerpBox(smoothedBoxesRef.current[i], detected[i], lerpT);
                    applyBlurToRegion(ctx, smoothedBoxesRef.current[i], opts.mode, opts.strength, opts.padding, canvas.width);
                }

                // If face was recently detected, keep blurring the smoothed box (until expire)
                if (detected.length === 0 && smoothedBoxesRef.current.length > 0) {
                    smoothedBoxesRef.current.forEach(b => applyBlurToRegion(ctx, b, opts.mode, opts.strength, opts.padding, canvas.width));
                }
            } else if (opts.enabled && (!useMlDetection || !detectorRef.current)) {
                // Fallback: use motion centroid so the blur follows the user's movements
                // instead of being stuck at a fixed center region.
                const box = getMotionCentroidBox(canvas.width, canvas.height);
                applyBlurToRegion(ctx, box, opts.mode, opts.strength, opts.padding, canvas.width);
            }

            animFrameRef.current = requestAnimationFrame(renderFrame);
        };

        renderingRef.current = true;
        animFrameRef.current = requestAnimationFrame(renderFrame);

        // Performance fix: pause rAF when tab is hidden, resume when visible
        const onVisibilityChange = () => {
            if (document.hidden) {
                cancelAnimationFrame(animFrameRef.current);
            } else if (renderingRef.current) {
                animFrameRef.current = requestAnimationFrame(renderFrame);
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        const fps = TIER_FPS[networkTierRef.current];
        try {
            const captured = (canvas as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(fps);
            blurredStream.current = captured;
            setBlurredStreamState(captured);
        } catch {
            console.warn('[useFaceBlur] captureStream not supported on this browser');
        }
        setReady(true);

        // Return cleanup so caller can remove the visibility listener
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, []);

    const start = useCallback(async (deviceId?: string) => {
        const stream = await initCamera(deviceId);
        if (!stream) return; // camera permission denied

        const video = videoRef.current!;

        // ── Wait for video to display (with race-safe logic) ──────────────────
        // If readyState >= 2 (HAVE_CURRENT_DATA) the metadata is already loaded.
        // Otherwise wait for loadeddata (fires after loadedmetadata so is safer),
        // with a hard 3 second timeout as a fallback.
        if (video.readyState < 2) {
            await Promise.race([
                new Promise<void>(res => {
                    const handler = () => { video.removeEventListener('loadeddata', handler); res(); };
                    video.addEventListener('loadeddata', handler);
                }),
                new Promise<void>(res => setTimeout(res, 3000)),
            ]);
        }

        // Start rendering immediately with whatever we have.
        // The canvas stream is captured here so blurredStreamState is set NOW.
        startRendering();

        // Kick off MediaPipe download in the background — if it succeeds,
        // the render loop will automatically start using it on the next frame.
        initDetector();
    }, [initCamera, initDetector, startRendering]);

    const stop = useCallback(() => {
        renderingRef.current = false;
        cancelAnimationFrame(animFrameRef.current);
        clearInterval(detectionIntervalRef.current);
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        blurredStream.current = null;
        setBlurredStreamState(null);
        setReady(false);
    }, []);

    /**
     * Pause camera: stop the physical camera (LED off), fill canvas black.
     * The captureStream is still alive so WebRTC senders keep running (black frame).
     */
    const pauseCamera = useCallback(() => {
        renderingRef.current = false;
        cancelAnimationFrame(animFrameRef.current);
        // Stop source tracks → turns off camera LED
        streamRef.current?.getVideoTracks().forEach(t => t.stop());
        // Fill canvas black so remote peer sees a black tile
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        setCameraEnabledState(false);
    }, []);

    /**
     * Resume camera: re-acquire the camera and restart the render loop.
     */
    const resumeCamera = useCallback(async () => {
        setCameraEnabledState(true);
        // Re-acquire camera (re-starts the LED)
        const stream = await initCamera();
        if (!stream) return;
        const video = videoRef.current!;
        if (video.readyState < 2) {
            await Promise.race([
                new Promise<void>(res => {
                    const h = () => { video.removeEventListener('loadeddata', h); res(); };
                    video.addEventListener('loadeddata', h);
                }),
                new Promise<void>(res => setTimeout(res, 3000)),
            ]);
        }
        startRendering();
    }, [initCamera, startRendering]);

    /**
     * Switch between front ('user') and back ('environment') camera.
     * Stops current tracks, re-acquires with the new facing mode, restarts rendering.
     */
    const switchCamera = useCallback(async (targetFacing?: 'user' | 'environment') => {
        // Toggle if not specified
        const newFacing = targetFacing ?? (activeFacingModeRef.current === 'user' ? 'environment' : 'user');
        // Stop current render loop and tracks
        renderingRef.current = false;
        cancelAnimationFrame(animFrameRef.current);
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        // Re-acquire with new facing mode
        const stream = await initCamera(undefined, newFacing);
        if (!stream) return;
        const video = videoRef.current!;
        if (video.readyState < 2) {
            await Promise.race([
                new Promise<void>(res => {
                    const h = () => { video.removeEventListener('loadeddata', h); res(); };
                    video.addEventListener('loadeddata', h);
                }),
                new Promise<void>(res => setTimeout(res, 3000)),
            ]);
        }
        startRendering();
    }, [initCamera, startRendering]);

    useEffect(() => () => stop(), [stop]);

    return {
        videoRef, canvasRef, blurredStream, blurredStreamState,
        start, stop, pauseCamera, resumeCamera, cameraEnabled,
        switchCamera, activeFacingMode,
        ready, error, facesDetected,
    };
}
