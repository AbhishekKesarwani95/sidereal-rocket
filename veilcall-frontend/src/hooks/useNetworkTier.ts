import { useEffect, useState } from 'react';

export type NetworkTier = 'low' | 'mid' | 'high';

// Maps Network Information API effectiveType → tier
function resolveTier(conn: NetworkInformation | undefined): NetworkTier {
    if (!conn) return 'high'; // fallback if API unsupported

    const { effectiveType, downlink } = conn as NetworkInformation & { downlink?: number };

    // downlink is in Mbps
    if (effectiveType === 'slow-2g' || effectiveType === '2g') return 'low';
    // 3G has enough headroom for mid-quality video on good signal
    if (effectiveType === '3g') return 'mid';
    if (downlink !== undefined) {
        if (downlink <= 0.8) return 'low';
        if (downlink <= 4) return 'mid';
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
    low: 100_000,  // 2G floor — enough for 240p slideshow
    mid: 450_000,  // 3G/4G — comfortable 480p video
    high: 1_200_000,
};

export const TIER_AUDIO_BITRATE: Record<NetworkTier, number> = {
    low: 24_000,   // Opus minimum for intelligible speech
    mid: 40_000,
    high: 64_000,
};

/** Friendly label for the UI badge */
export const TIER_LABEL: Record<NetworkTier, string> = {
    low: '📶 3G',
    mid: '📶 4G',
    high: '📶 5G',
};
