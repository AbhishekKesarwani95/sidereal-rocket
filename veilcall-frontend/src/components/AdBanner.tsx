import React from 'react';

interface AdBannerProps {
    variant: 'leaderboard' | 'horizontal' | 'square';
    label?: string;
}

export default function AdBanner({ variant, label = 'Advertisement' }: AdBannerProps) {
    const classMap = {
        leaderboard: 'ad-banner ad-banner-leaderboard',
        horizontal: 'ad-banner ad-banner-horizontal',
        square: 'ad-banner ad-banner-square',
    };
    const sizes: Record<string, string> = {
        leaderboard: '728×90',
        horizontal: '468×60',
        square: '300×250',
    };
    return (
        <div className={classMap[variant]} aria-label="Advertisement" role="complementary">
            <span>{label} · {sizes[variant]}</span>
        </div>
    );
}
