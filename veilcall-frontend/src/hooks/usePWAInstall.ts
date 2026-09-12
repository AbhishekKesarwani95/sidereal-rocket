import { useEffect, useState } from 'react';

interface PWAInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Captures the browser's beforeinstallprompt event and exposes a trigger function.
 * Returns:
 *   - canInstall: true when the browser has made an install prompt available
 *   - triggerInstall: call this from a button click to show the native prompt
 *   - isInstalled: true when running as a standalone installed PWA
 */
export function usePWAInstall() {
    const [promptEvent, setPromptEvent] = useState<PWAInstallPromptEvent | null>(null);
    const [isInstalled, setIsInstalled] = useState(false);

    useEffect(() => {
        // Already running as installed PWA?
        const mq = window.matchMedia('(display-mode: standalone)');
        if (mq.matches || (navigator as any).standalone === true) {
            setIsInstalled(true);
        }

        const handler = (e: Event) => {
            e.preventDefault();
            setPromptEvent(e as PWAInstallPromptEvent);
        };

        // Also pick up any event captured in index.html before React mounted
        const deferred = (window as any).deferredPWAPrompt as PWAInstallPromptEvent | undefined;
        if (deferred) {
            setPromptEvent(deferred);
            delete (window as any).deferredPWAPrompt;
        }

        window.addEventListener('beforeinstallprompt', handler);

        window.addEventListener('appinstalled', () => {
            setIsInstalled(true);
            setPromptEvent(null);
        });

        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const triggerInstall = async () => {
        if (!promptEvent) return;
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice.outcome === 'accepted') {
            setIsInstalled(true);
        }
        setPromptEvent(null);
    };

    return {
        canInstall: !!promptEvent && !isInstalled,
        isInstalled,
        triggerInstall,
    };
}
