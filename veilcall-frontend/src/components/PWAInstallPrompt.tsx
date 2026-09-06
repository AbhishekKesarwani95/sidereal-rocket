import { useEffect, useState } from 'react';
import './PWAInstallPrompt.css';

// The deferred prompt is captured in index.html's beforeinstallprompt handler
declare global {
    interface Window {
        deferredPWAPrompt?: BeforeInstallPromptEvent;
    }
}

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'pwa-install-dismissed';

export default function PWAInstallPrompt() {
    const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        // If user already dismissed, don't show for 7 days
        const ts = localStorage.getItem(DISMISSED_KEY);
        if (ts && Date.now() - Number(ts) < 7 * 24 * 60 * 60 * 1000) return;

        // Check if prompt was already captured before this component mounted
        if (window.deferredPWAPrompt) {
            setPrompt(window.deferredPWAPrompt);
            setVisible(true);
            return;
        }

        const handler = (e: Event) => {
            e.preventDefault();
            const evt = e as BeforeInstallPromptEvent;
            window.deferredPWAPrompt = evt;
            setPrompt(evt);
            // Small delay so the page isn't bombarded on load
            setTimeout(() => setVisible(true), 3000);
        };

        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    if (!visible || !prompt) return null;

    const handleInstall = async () => {
        setVisible(false);
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') {
            window.deferredPWAPrompt = undefined;
        }
    };

    const handleDismiss = () => {
        setVisible(false);
        localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    };

    return (
        <div className="pwa-banner" role="dialog" aria-label="Install Veilcall app">
            <div className="pwa-banner-icon" aria-hidden="true">📲</div>
            <div className="pwa-banner-text">
                <strong>Add Veilcall to your home screen</strong>
                <span>Works offline · No app store needed</span>
            </div>
            <div className="pwa-banner-actions">
                <button className="btn btn-primary btn-sm" onClick={handleInstall}>
                    Install
                </button>
                <button
                    className="pwa-banner-close"
                    onClick={handleDismiss}
                    aria-label="Dismiss"
                >
                    ✕
                </button>
            </div>
        </div>
    );
}
