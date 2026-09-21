import { useRef, useState, useCallback, useEffect } from 'react';
import { SignalingClient } from '../lib/signal';
import { type NetworkTier, TIER_VIDEO_BITRATE, TIER_AUDIO_BITRATE } from './useNetworkTier';

// ── Derive server URL from current page so it works via Vite proxy ─────────────
const API_BASE = import.meta.env.VITE_API_BASE ?? '';
function getSignalServer() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}`;
}

export interface PeerState {
    peerId: string;
    stream: MediaStream | null;
    connected: boolean;
    muted: boolean;
    videoOff: boolean;
}

interface UseWebRTCOptions {
    roomCode: string;
    localStream: MediaStream | null;
    networkTier?: NetworkTier;
    onError?: (msg: string) => void;
    onChatMessage?: (from: string, text: string, ts: number) => void;
    onReaction?: (from: string, emoji: string) => void;
    onPeerWaiting?: (peerId: string) => void;
    onWaitingForApproval?: () => void;
    onScreenShareStop?: () => void;
}

/** Apply per-sender bitrate caps based on current network tier */
async function applyEncodingParams(pc: RTCPeerConnection, tier: NetworkTier) {
    const senders = pc.getSenders();
    for (const sender of senders) {
        if (!sender.track) continue;
        try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
                params.encodings = [{}];
            }
            const maxBitrate =
                sender.track.kind === 'video'
                    ? TIER_VIDEO_BITRATE[tier]
                    : TIER_AUDIO_BITRATE[tier];
            params.encodings.forEach((enc) => {
                enc.maxBitrate = maxBitrate;
            });
            await sender.setParameters(params);
        } catch {
            // setParameters may fail before negotiation completes — silently skip
        }
    }
}

export function useWebRTC({ roomCode, localStream, networkTier = 'high', autoConnect = false, onError, onChatMessage, onReaction, onPeerWaiting, onWaitingForApproval, onScreenShareStop }: UseWebRTCOptions & { autoConnect?: boolean }) {
    const [myPeerId, setMyPeerId] = useState<string>('');
    const [peers, setPeers] = useState<Map<string, PeerState>>(new Map());
    const [connected, setConnected] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [isWaiting, setIsWaiting] = useState(false);

    const signaling = useRef<SignalingClient | null>(null);
    const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
    const turnCredRef = useRef<{ username: string; credential: string } | null>(null);
    const networkTierRef = useRef<NetworkTier>(networkTier);
    const screenStreamRef = useRef<MediaStream | null>(null);
    // Bug 1 fix: buffer ICE candidates that arrive before setRemoteDescription
    const iceCandidateQueue = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
    // Per-peer negotiation guard: prevents onnegotiationneeded from double-firing
    // during the reconnect teardown+recreate cycle (causes 2-joined/no-video race).
    const negotiatingRef = useRef<Map<string, boolean>>(new Map());

    // Always keep a fresh reference to callbacks and stream
    const onChatMessageRef = useRef(onChatMessage);
    const onErrorRef = useRef(onError);
    const onReactionRef = useRef(onReaction);
    const onPeerWaitingRef = useRef(onPeerWaiting);
    const onWaitingForApprovalRef = useRef(onWaitingForApproval);
    const onScreenShareStopRef = useRef(onScreenShareStop);
    useEffect(() => { onChatMessageRef.current = onChatMessage; }, [onChatMessage]);
    useEffect(() => { onErrorRef.current = onError; }, [onError]);
    useEffect(() => { onReactionRef.current = onReaction; }, [onReaction]);
    useEffect(() => { onPeerWaitingRef.current = onPeerWaiting; }, [onPeerWaiting]);
    useEffect(() => { onWaitingForApprovalRef.current = onWaitingForApproval; }, [onWaitingForApproval]);
    useEffect(() => { onScreenShareStopRef.current = onScreenShareStop; }, [onScreenShareStop]);

    // Re-apply encoding params whenever the network tier changes mid-call
    useEffect(() => {
        networkTierRef.current = networkTier;
        pcs.current.forEach((pc) => {
            applyEncodingParams(pc, networkTier);
        });
    }, [networkTier]);

    const localStreamRef = useRef<MediaStream | null>(localStream);
    useEffect(() => {
        localStreamRef.current = localStream;
        if (!localStream) return;

        // When stream becomes available, add/replace tracks on ALL existing PCs
        pcs.current.forEach((pc, peerId) => {
            const senders = pc.getSenders();
            localStream.getTracks().forEach((track) => {
                const existing = senders.find((s) => s.track?.kind === track.kind);
                if (existing) {
                    existing.replaceTrack(track).catch(console.error);
                } else {
                    pc.addTrack(track, localStream);
                    // addTrack triggers onnegotiationneeded which re-offers automatically
                }
            });
            // Re-apply bitrate caps immediately after tracks land
            applyEncodingParams(pc, networkTierRef.current);
            void peerId; // suppress warning
        });
    }, [localStream]);

    // autoConnectFiredRef is used by effects placed AFTER connect() is declared (below)
    const autoConnectFiredRef = useRef(false);

    /**
     * Explicitly push current tracks from localStreamRef to all existing PCs.
     * Call this after mutating a stable MediaStream in-place (add/removeTrack),
     * since React won't re-fire the localStream effect for the same object reference.
     */
    const refreshTracks = useCallback(() => {
        const stream = localStreamRef.current;
        if (!stream) return;
        pcs.current.forEach((pc) => {
            const senders = pc.getSenders();
            stream.getTracks().forEach((track) => {
                const existing = senders.find((s) => s.track?.kind === track.kind);
                if (existing) {
                    existing.replaceTrack(track).catch(console.error);
                } else {
                    pc.addTrack(track, stream);
                }
            });
        });
    }, []);

    const getIceServers = useCallback((): RTCIceServer[] => {
        const servers: RTCIceServer[] = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ];
        const creds = turnCredRef.current;
        if (creds && import.meta.env.VITE_TURN_HOST) {
            servers.push({
                urls: `turn:${import.meta.env.VITE_TURN_HOST}:3478`,
                username: creds.username,
                credential: creds.credential,
            });
        }
        return servers;
    }, []);

    const createPeerConnection = useCallback((peerId: string) => {
        if (pcs.current.has(peerId)) return pcs.current.get(peerId)!;

        const pc = new RTCPeerConnection({ iceServers: getIceServers() });
        pcs.current.set(peerId, pc);

        // Add whatever tracks we have right now (may be empty if camera not ready yet)
        const stream = localStreamRef.current;
        if (stream) {
            stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        }

        // ── Remote stream ─────────────────────────────────────────────────────
        const remoteStream = new MediaStream();
        pc.ontrack = (e) => {
            // Bug 1 fix: always add e.track directly (Firefox/Safari deliver track
            // without populating e.streams[], so e.streams[0] alone is not reliable)
            if (e.track && !remoteStream.getTrackById(e.track.id)) {
                remoteStream.addTrack(e.track);
                // When the track ends, remove it so the tile updates correctly
                e.track.onended = () => remoteStream.removeTrack(e.track);
            }
            // Also sync tracks from the MediaStream if present (Chrome compat)
            e.streams[0]?.getTracks().forEach((t) => {
                if (!remoteStream.getTrackById(t.id)) remoteStream.addTrack(t);
            });
            setPeers((prev) => {
                const next = new Map(prev);
                const p = next.get(peerId);
                if (p) next.set(peerId, { ...p, stream: remoteStream, connected: true });
                return next;
            });
        };

        // ── ICE ───────────────────────────────────────────────────────────────
        pc.onicecandidate = (e) => {
            if (e.candidate) {
                signaling.current?.sendTo(peerId, {
                    type: 'ice-candidate',
                    payload: e.candidate.toJSON(),
                });
            }
        };

        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'failed') {
                pc.restartIce();
                // If still failed after 8 s, remove the ghost tile so the peer count is accurate
                setTimeout(() => {
                    if (pc.iceConnectionState === 'failed') {
                        pc.close();
                        pcs.current.delete(peerId);
                        iceCandidateQueue.current.delete(peerId);
                        negotiatingRef.current.delete(peerId);
                        setPeers((prev) => { const next = new Map(prev); next.delete(peerId); return next; });
                    }
                }, 8000);
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                applyEncodingParams(pc, networkTierRef.current);
                setPeers((prev) => {
                    const next = new Map(prev);
                    const p = next.get(peerId);
                    if (p) next.set(peerId, { ...p, connected: true });
                    return next;
                });
            } else if (pc.connectionState === 'failed') {
                // Hard failure — remove peer tile immediately
                pc.close();
                pcs.current.delete(peerId);
                iceCandidateQueue.current.delete(peerId);
                negotiatingRef.current.delete(peerId);
                setPeers((prev) => { const next = new Map(prev); next.delete(peerId); return next; });
            } else if (pc.connectionState === 'disconnected') {
                // Brief disconnection (tab switch, network hiccup) — give 12 s to recover
                setTimeout(() => {
                    if (pc.connectionState === 'disconnected') {
                        pc.close();
                        pcs.current.delete(peerId);
                        iceCandidateQueue.current.delete(peerId);
                        negotiatingRef.current.delete(peerId);
                        setPeers((prev) => { const next = new Map(prev); next.delete(peerId); return next; });
                    }
                }, 12000);
            }
        };

        // ── Renegotiation (triggered when tracks are added late) ──────────────
        // Guard against: (a) closed PCs, (b) double-fire from room-joined teardown+recreate.
        pc.onnegotiationneeded = async () => {
            // Exit immediately if the PC has been torn down
            if (pc.signalingState === 'closed') return;
            // Prevent re-entrant offers on the same peer during reconnect
            if (negotiatingRef.current.get(peerId)) return;
            negotiatingRef.current.set(peerId, true);
            try {
                // If not stable, wait until signaling settles before proceeding
                if (pc.signalingState !== 'stable') {
                    await new Promise<void>((resolve) => {
                        const check = () => {
                            if (pc.signalingState === 'stable' || pc.signalingState === 'closed') {
                                pc.removeEventListener('signalingstatechange', check);
                                resolve();
                            }
                        };
                        pc.addEventListener('signalingstatechange', check);
                        setTimeout(resolve, 5000);
                    });
                }
                if (pc.signalingState !== 'stable') return;
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                signaling.current?.sendTo(peerId, { type: 'offer', payload: offer });
            } catch { }
            finally {
                negotiatingRef.current.set(peerId, false);
            }
        };

        return pc;
    }, [getIceServers]);

    const connect = useCallback(async () => {
        if (!roomCode) return;

        // ── 1. Validate room exists (HTTP) ────────────────────────────────────
        try {
            const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/join`);
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                onErrorRef.current?.(data.error ?? 'Failed to join room');
                return;
            }
            const data = await res.json();
            turnCredRef.current = data.turnCreds ?? null;
        } catch (err) {
            // Network error – room might still exist; try WebSocket anyway
            console.warn('[useWebRTC] Join API failed, trying WebSocket anyway', err);
        }

        // ── 2. Create stable peer ID ──────────────────────────────────────────
        const peerId = crypto.randomUUID();
        setMyPeerId(peerId);

        // ── 3. Open WebSocket signaling ───────────────────────────────────────
        const client = new SignalingClient(getSignalServer(), roomCode, peerId);
        signaling.current = client;

        // room-joined: WE just entered the room. WE are the offerer for every existing peer.
        // Do NOT call createPeerConnection here (it triggers onnegotiationneeded which races
        // with our explicit createOffer below). Instead, build the PC manually.
        client.on('room-joined', async (msg) => {
            setConnected(true);
            for (const existingPeer of msg.peers ?? []) {
                // On reconnect, tear down any stale PC first
                if (pcs.current.has(existingPeer)) {
                    pcs.current.get(existingPeer)!.close();
                    pcs.current.delete(existingPeer);
                    iceCandidateQueue.current.delete(existingPeer);
                    negotiatingRef.current.delete(existingPeer);
                }
                setPeers((prev) => {
                    const next = new Map(prev);
                    if (!next.has(existingPeer))
                        next.set(existingPeer, { peerId: existingPeer, stream: null, connected: false, muted: false, videoOff: false });
                    return next;
                });

                // Mark as negotiating BEFORE creating PC so onnegotiationneeded is suppressed.
                // We will drive the offer ourselves below.
                negotiatingRef.current.set(existingPeer, true);
                const pc = createPeerConnection(existingPeer);

                try {
                    // Wait for stable (PC is new so should be immediate)
                    if (pc.signalingState !== 'stable') {
                        await new Promise<void>((resolve) => {
                            const check = () => {
                                if (pc.signalingState === 'stable' || pc.signalingState === 'closed') {
                                    pc.removeEventListener('signalingstatechange', check);
                                    resolve();
                                }
                            };
                            pc.addEventListener('signalingstatechange', check);
                            setTimeout(resolve, 4000);
                        });
                    }
                    if (pc.signalingState !== 'stable') continue;
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    client.sendTo(existingPeer, { type: 'offer', payload: offer });
                } catch (e) {
                    console.error('[useWebRTC] offer creation failed', e);
                } finally {
                    negotiatingRef.current.set(existingPeer, false);
                }
            }
        });

        // peer-joined: an existing peer; THEY are the offerer — we just wait for their offer.
        // Suppress onnegotiationneeded on our side by pre-setting the guard so we don't
        // accidentally race them with our own offer (classic glare).
        client.on('peer-joined', (msg) => {
            const id = msg.from ?? (msg as any).peerId;
            if (!id) return;
            setPeers((prev) => {
                const next = new Map(prev);
                if (!next.has(id))
                    next.set(id, { peerId: id, stream: null, connected: false, muted: false, videoOff: false });
                return next;
            });
            // Pre-set guard: the joining peer will send the offer; we must not send one too.
            negotiatingRef.current.set(id, true);
            createPeerConnection(id);
            // Clear guard after a short window so normal renegotiation (e.g. track changes)
            // works later. Using setTimeout(0) lets the current addTrack onnegotiationneeded
            // fire-and-be-suppressed before we clear.
            setTimeout(() => negotiatingRef.current.set(id, false), 500);
        });

        // offer: remote peer (the joiner) is initiating — we are the answerer.
        // Pre-set the guard before createPeerConnection to prevent our onnegotiationneeded
        // from firing a competing offer while we process theirs.
        client.on('offer', async (msg) => {
            if (!msg.from || !msg.payload) return;

            // Suppress onnegotiationneeded on our side — we're the answerer here
            negotiatingRef.current.set(msg.from, true);

            // Tear down any existing closed PC so we start fresh
            const existing = pcs.current.get(msg.from);
            if (existing && existing.signalingState !== 'closed') {
                if (existing.signalingState !== 'have-local-offer') {
                    existing.close();
                    pcs.current.delete(msg.from);
                    iceCandidateQueue.current.delete(msg.from);
                }
            }

            const pc = createPeerConnection(msg.from);
            if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
                negotiatingRef.current.set(msg.from, false);
                return;
            }
            try {
                await pc.setRemoteDescription(
                    new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit),
                );
                // Flush queued ICE candidates
                const queued = iceCandidateQueue.current.get(msg.from) ?? [];
                iceCandidateQueue.current.delete(msg.from);
                for (const c of queued) {
                    try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { }
                }
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                client.sendTo(msg.from, { type: 'answer', payload: answer });
            } catch (e) {
                console.error('[useWebRTC] answer creation failed', e);
            } finally {
                // Release guard so future renegotiation (e.g. track changes) works
                negotiatingRef.current.set(msg.from, false);
            }
        });

        // answer: remote answered our offer
        client.on('answer', async (msg) => {
            if (!msg.from || !msg.payload) return;
            const pc = pcs.current.get(msg.from);
            if (pc && pc.signalingState === 'have-local-offer') {
                await pc.setRemoteDescription(
                    new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit),
                );
                // Bug 1 fix: flush queued ICE candidates now that remote SDP is set
                const queued = iceCandidateQueue.current.get(msg.from) ?? [];
                iceCandidateQueue.current.delete(msg.from);
                for (const c of queued) {
                    try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { }
                }
            }
        });

        // ICE candidate
        // Bug 1 fix: queue candidates if remote description is not yet set
        client.on('ice-candidate', async (msg) => {
            if (!msg.from || !msg.payload) return;
            const pc = pcs.current.get(msg.from);
            if (!pc || !pc.remoteDescription) {
                // No peer connection yet or SDP not set — queue the candidate
                const q = iceCandidateQueue.current.get(msg.from) ?? [];
                q.push(msg.payload as RTCIceCandidateInit);
                iceCandidateQueue.current.set(msg.from, q);
                return;
            }
            try { await pc.addIceCandidate(new RTCIceCandidate(msg.payload as RTCIceCandidateInit)); } catch { }
        });

        // chat
        client.on('chat', (msg) => {
            if (msg.from && msg.payload) {
                const { text, ts } = msg.payload as { text: string; ts: number };
                // Note: callback signature is (text, from, ts)
                onChatMessageRef.current?.(text, msg.from, ts ?? Date.now());
            }
        });

        // peer-meta (reactions + mute/video/screenshare state)
        client.on('peer-meta', (msg) => {
            if (!msg.from || !msg.payload) return;
            const p = msg.payload as Record<string, unknown>;
            if (p.action === 'reaction') {
                onReactionRef.current?.(msg.from, String(p.emoji ?? ''));
            } else if (p.action === 'screenshare') {
                // Remote peer started or stopped screen sharing — update their tile label/state
                setPeers((prev) => {
                    const next = new Map(prev);
                    const peer = next.get(msg.from!);
                    if (peer) next.set(msg.from!, { ...peer, videoOff: false });
                    return next;
                });
            }
        });

        // waiting room — waiting for host to admit us
        client.on('waiting-for-approval', () => {
            setIsWaiting(true);
            onWaitingForApprovalRef.current?.();
        });

        // waiting room — a new peer is waiting (host sees this)
        client.on('peer-waiting', (msg) => {
            const id = msg.from ?? (msg as any).peerId;
            if (id) onPeerWaitingRef.current?.(id);
        });

        // waiting room — we were approved
        client.on('peer-approved', () => {
            setIsWaiting(false);
        });

        // peer-left
        client.on('peer-left', (msg) => {
            const id = msg.from ?? (msg as any).peerId;
            if (!id) return;
            pcs.current.get(id)?.close();
            pcs.current.delete(id);
            iceCandidateQueue.current.delete(id);
            setPeers((prev) => {
                const next = new Map(prev);
                next.delete(id);
                // Auto-stop our own screen share when there are no peers left
                // (avoids leaving screen share running into the void after last peer leaves)
                if (next.size === 0 && screenStreamRef.current) {
                    screenStreamRef.current.getTracks().forEach(t => t.stop());
                    screenStreamRef.current = null;
                    setIsScreenSharing(false);
                    onScreenShareStopRef.current?.();
                }
                return next;
            });
        });

        // room-closed
        client.on('room-closed', () => {
            setConnected(false);
            onErrorRef.current?.('Room has been closed.');
        });

        client.connect();
    }, [roomCode, createPeerConnection]);

    // ── Auto-connect effects (must be after `connect` is declared) ────────────
    // Effect 1: reset the once-per-room guard whenever roomCode changes
    useEffect(() => {
        if (!autoConnect) return;
        autoConnectFiredRef.current = false;
    }, [roomCode, autoConnect]);
    // Effect 2: call connect() once roomCode + localStream are both ready
    useEffect(() => {
        if (!autoConnect) return;
        if (autoConnectFiredRef.current) return;
        if (!roomCode) return;
        if ((localStream?.getTracks().length ?? 0) === 0) return;
        autoConnectFiredRef.current = true;
        connect();
    }, [autoConnect, roomCode, localStream, connect]);

    const disconnect = useCallback(() => {
        signaling.current?.disconnect();
        signaling.current = null;
        pcs.current.forEach((pc) => pc.close());
        pcs.current.clear();
        setPeers(new Map());
        setConnected(false);
    }, []);

    const sendChatMessage = useCallback((text: string) => {
        signaling.current?.send({ type: 'chat', payload: { text, ts: Date.now() } });
    }, []);

    // Client-side reaction rate limit: max 5 per 10 seconds
    const reactionTimestamps = useRef<number[]>([]);
    const sendReaction = useCallback((emoji: string) => {
        const now = Date.now();
        reactionTimestamps.current = reactionTimestamps.current.filter(t => now - t < 10_000);
        if (reactionTimestamps.current.length >= 5) return; // throttled
        reactionTimestamps.current.push(now);
        signaling.current?.send({ type: 'peer-meta', payload: { action: 'reaction', emoji } });
    }, []);

    const approvePeer = useCallback((peerId: string) => {
        signaling.current?.send({ type: 'peer-meta', payload: { action: 'approve', peerId } });
    }, []);

    const rejectPeer = useCallback((peerId: string) => {
        signaling.current?.send({ type: 'peer-meta', payload: { action: 'reject', peerId } });
    }, []);

    /** Toggle screen share. Replaces the video track on all PCs.
     *  - On mobile (no getDisplayMedia support), shows a clear error.
     *  - Auto-reverts when user stops from browser native UI.
     *  - Broadcasts screenshare state via peer-meta so remote peers are notified. */
    const shareScreen = useCallback(async () => {
        // ── Mobile detection ──────────────────────────────────────────────────
        // getDisplayMedia is not available on iOS or most Android browsers.
        // Detect early and surface a clear error rather than a cryptic failure.
        const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile && !('getDisplayMedia' in (navigator.mediaDevices ?? {}))) {
            onErrorRef.current?.(
                'Screen sharing is not supported on this device. ' +
                'Please use a desktop browser to share your screen.'
            );
            return;
        }

        if (isScreenSharing) {
            // Stop screen tracks and revert to camera
            screenStreamRef.current?.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
            setIsScreenSharing(false);
            // Notify peers we stopped
            signaling.current?.send({ type: 'peer-meta', payload: { action: 'screenshare', active: false } });
            const camTrack = localStreamRef.current?.getVideoTracks()[0];
            if (camTrack) {
                pcs.current.forEach(pc => {
                    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(camTrack).catch(console.error);
                    } else {
                        pc.addTrack(camTrack, localStreamRef.current!);
                    }
                });
            }
            return;
        }
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 30 } },
                audio: false,
            });
            const screenTrack = screenStream.getVideoTracks()[0];
            if (!screenTrack) return;
            screenStreamRef.current = screenStream;
            setIsScreenSharing(true);
            // Notify peers we started
            signaling.current?.send({ type: 'peer-meta', payload: { action: 'screenshare', active: true } });
            pcs.current.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(screenTrack).catch(console.error);
                } else {
                    pc.addTrack(screenTrack, screenStream);
                }
            });
            // Revert when user clicks "Stop sharing" in browser native UI
            screenTrack.onended = () => {
                setIsScreenSharing(false);
                screenStreamRef.current = null;
                signaling.current?.send({ type: 'peer-meta', payload: { action: 'screenshare', active: false } });
                const camTrack = localStreamRef.current?.getVideoTracks()[0];
                if (camTrack) {
                    pcs.current.forEach(pc => {
                        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                        if (sender) sender.replaceTrack(camTrack).catch(console.error);
                        else pc.addTrack(camTrack, localStreamRef.current!);
                    });
                }
            };
        } catch (err) {
            // User cancelled — no-op. Any other error surfaces to UI.
            if (err instanceof Error && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
                onErrorRef.current?.(`Screen share failed: ${err.message}`);
            }
        }
    }, [isScreenSharing]);

    useEffect(() => () => disconnect(), [disconnect]);

    return { myPeerId, peers, connected, connect, disconnect, sendChatMessage, sendReaction, shareScreen, isScreenSharing, approvePeer, rejectPeer, isWaiting, refreshTracks };
}
