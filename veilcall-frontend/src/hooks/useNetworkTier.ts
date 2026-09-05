import { useEffect, useState } from 'react';

export type NetworkTier = 'low' | 'mid' | 'high';

// Maps Network Information API effectiveType → tier
function resolveTier(conn: NetworkInformation | undefined): NetworkTier {
    if (!conn) return 'high'; // fallback if API unsupported

    const { effectiveType, downlink } = conn as NetworkInformation & { downlink?: number };

    // downlink is in Mbps
    if (effectiveType === 'slow-2g' || effectiveType === '2g') return 'low';
    if (effectiveType === '3g') return 'low'; // 3G is still low for video
    if (downlink !== undefined) {
        if (downlink <= 1.5) return 'low';
        if (downlink <= 5) return 'mid';
        return 'high';
    }
    if (effectiveType === '4g') return 'mid';
    return 'high';
}

// Minimal augmentation of the Navigator interface
interface NetworkInformation extends EventTarget {
    readonly effectiveType: 'slow-2g' | '2g' | '3g' | '4g';
    readonly downlink?: number;
    onchange: ((this: NetworkInformation, ev: Event) => void) | null;
}

interface NavigatorWithConnection extends Navigator {
    readonly connection?: NetworkInformation;
}

/**
 * Returns the current network tier: 'low' | 'mid' | 'high'.
 * Re-evaluates whenever the connection changes.
 *
 *  low  — 3G / ≤1.5 Mbps  → 80 kbps video, 480p
 *  mid  — 4G / ≤5 Mbps    → 400 kbps video, 720p
 *  high — 5G / WiFi        → 1200 kbps video, 720p+
 */
export function useNetworkTier(): NetworkTier {
    const conn = (navigator as NavigatorWithConnection).connection;
    const [tier, setTier] = useState<NetworkTier>(() => resolveTier(conn));

    useEffect(() => {
        if (!conn) return;
        const update = () => setTier(resolveTier(conn));
        conn.addEventListener('change', update);
        return () => conn.removeEventListener('change', update);
    }, [conn]);

    return tier;
}

/** Bitrate caps (bps) per tier */
export const TIER_VIDEO_BITRATE: Record<NetworkTier, number> = {
    low: 60_000,   // reduced to preserve bandwidth for audio on 3G
    mid: 400_000,
    high: 1_200_000,
};

export const TIER_AUDIO_BITRATE: Record<NetworkTier, number> = {
    low: 32_000,   // 16k was below Opus speech floor — raised to maintain audio clarity
    mid: 40_000,
    high: 64_000,
};

/** Friendly label for the UI badge */
export const TIER_LABEL: Record<NetworkTier, string> = {
    low: '📶 3G',
    mid: '📶 4G',
    high: '📶 5G',
};
