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

export function useWebRTC({ roomCode, localStream, networkTier = 'high', onError, onChatMessage, onReaction, onPeerWaiting, onWaitingForApproval }: UseWebRTCOptions) {
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

    // Always keep a fresh reference to callbacks and stream
    const onChatMessageRef = useRef(onChatMessage);
    const onErrorRef = useRef(onError);
    const onReactionRef = useRef(onReaction);
    const onPeerWaitingRef = useRef(onPeerWaiting);
    const onWaitingForApprovalRef = useRef(onWaitingForApproval);
    useEffect(() => { onChatMessageRef.current = onChatMessage; }, [onChatMessage]);
    useEffect(() => { onErrorRef.current = onError; }, [onError]);
    useEffect(() => { onReactionRef.current = onReaction; }, [onReaction]);
    useEffect(() => { onPeerWaitingRef.current = onPeerWaiting; }, [onPeerWaiting]);
    useEffect(() => { onWaitingForApprovalRef.current = onWaitingForApproval; }, [onWaitingForApproval]);

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
            void peerId; // suppress warning
        });
    }, [localStream]);

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
            if (pc.iceConnectionState === 'failed') pc.restartIce();
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                // Apply bitrate caps as soon as the connection is established
                applyEncodingParams(pc, networkTierRef.current);
                setPeers((prev) => {
                    const next = new Map(prev);
                    const p = next.get(peerId);
                    if (p) next.set(peerId, { ...p, connected: true });
                    return next;
                });
            }
        };

        // ── Renegotiation (triggered when tracks are added late) ──────────────
        // Bug 5 fix: guard against glare — only send offer when state is stable
        pc.onnegotiationneeded = async () => {
            if (pc.signalingState !== 'stable') return;
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                signaling.current?.sendTo(peerId, { type: 'offer', payload: offer });
            } catch { }
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

        // room-joined: we just entered the room
        client.on('room-joined', async (msg) => {
            setConnected(true);
            for (const existingPeer of msg.peers ?? []) {
                setPeers((prev) => {
                    const next = new Map(prev);
                    if (!next.has(existingPeer))
                        next.set(existingPeer, { peerId: existingPeer, stream: null, connected: false, muted: false, videoOff: false });
                    return next;
                });
                // We are initiator: pre-create PC (tracks added now if camera is ready,
                // or later via onnegotiationneeded when tracks arrive)
                const pc = createPeerConnection(existingPeer);
                // Only create offer if we already have tracks; otherwise onnegotiationneeded will fire
                if (pc.getSenders().length > 0) {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    client.sendTo(existingPeer, { type: 'offer', payload: offer });
                }
                // If no tracks yet, onnegotiationneeded fires when tracks are added
            }
        });

        // peer-joined: someone new arrived; they will initiate
        client.on('peer-joined', (msg) => {
            const id = msg.from ?? (msg as any).peerId;
            if (!id) return;
            setPeers((prev) => {
                const next = new Map(prev);
                if (!next.has(id))
                    next.set(id, { peerId: id, stream: null, connected: false, muted: false, videoOff: false });
                return next;
            });
            createPeerConnection(id); // pre-create so offer arrives to a ready PC
        });

        // offer: remote is initiating
        client.on('offer', async (msg) => {
            if (!msg.from || !msg.payload) return;
            const pc = createPeerConnection(msg.from);
            await pc.setRemoteDescription(
                new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit),
            );
            // Bug 1 fix: flush queued ICE candidates now that remote SDP is set
            const queued = iceCandidateQueue.current.get(msg.from) ?? [];
            iceCandidateQueue.current.delete(msg.from);
            for (const c of queued) {
                try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { }
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            client.sendTo(msg.from, { type: 'answer', payload: answer });
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
                onChatMessageRef.current?.(msg.from, text, ts ?? Date.now());
            }
        });

        // peer-meta (reactions + mute/video state)
        client.on('peer-meta', (msg) => {
            if (!msg.from || !msg.payload) return;
            const p = msg.payload as Record<string, unknown>;
            if (p.action === 'reaction') {
                onReactionRef.current?.(msg.from, String(p.emoji ?? ''));
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
            setPeers((prev) => { const next = new Map(prev); next.delete(id); return next; });
        });

        // room-closed
        client.on('room-closed', () => {
            setConnected(false);
            onErrorRef.current?.('Room has been closed.');
        });

        client.connect();
    }, [roomCode, createPeerConnection]);

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

    const sendReaction = useCallback((emoji: string) => {
        signaling.current?.send({ type: 'peer-meta', payload: { action: 'reaction', emoji } });
    }, []);

    const approvePeer = useCallback((peerId: string) => {
        signaling.current?.send({ type: 'peer-meta', payload: { action: 'approve', peerId } });
    }, []);

    const rejectPeer = useCallback((peerId: string) => {
        signaling.current?.send({ type: 'peer-meta', payload: { action: 'reject', peerId } });
    }, []);

    /** Toggle screen share. Replaces the video track on all PCs. Auto-reverts when user stops from browser UI. */
    const shareScreen = useCallback(async () => {
        if (isScreenSharing) {
            screenStreamRef.current?.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
            setIsScreenSharing(false);
            const camTrack = localStreamRef.current?.getVideoTracks()[0];
            if (camTrack) {
                pcs.current.forEach(pc => {
                    pc.getSenders().find(s => s.track?.kind === 'video')?.replaceTrack(camTrack).catch(console.error);
                });
            }
            return;
        }
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            const screenTrack = screenStream.getVideoTracks()[0];
            if (!screenTrack) return;
            screenStreamRef.current = screenStream;
            setIsScreenSharing(true);
            pcs.current.forEach(pc => {
                pc.getSenders().find(s => s.track?.kind === 'video')?.replaceTrack(screenTrack).catch(console.error);
            });
            // Revert when user clicks "Stop sharing" in the browser's native UI
            screenTrack.onended = () => {
                setIsScreenSharing(false);
                screenStreamRef.current = null;
                const camTrack = localStreamRef.current?.getVideoTracks()[0];
                if (camTrack) {
                    pcs.current.forEach(pc => {
                        pc.getSenders().find(s => s.track?.kind === 'video')?.replaceTrack(camTrack).catch(console.error);
                    });
                }
            };
        } catch { /* user cancelled or permission denied */ }
    }, [isScreenSharing]);

    useEffect(() => () => disconnect(), [disconnect]);

    return { myPeerId, peers, connected, connect, disconnect, sendChatMessage, sendReaction, shareScreen, isScreenSharing, approvePeer, rejectPeer, isWaiting };
}
