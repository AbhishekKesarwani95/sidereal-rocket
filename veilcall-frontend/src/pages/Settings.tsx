import { useState, useEffect } from 'react';

export default function Settings() {
    const [blurDefault, setBlurDefault] = useState(() => localStorage.getItem('vc_blur_default') !== 'false');
    const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');

    useEffect(() => {
        if ('Notification' in window) setNotifPermission(Notification.permission);
    }, []);

    const save = () => {
        localStorage.setItem('vc_blur_default', blurDefault ? 'true' : 'false');
    };

    const requestNotif = async () => {
        if ('Notification' in window) {
            const perm = await Notification.requestPermission();
            setNotifPermission(perm);
        }
    };

    return (
        <div className="page-wrapper" style={{ paddingTop: 'var(--sp-10)' }}>
            <div className="container" style={{ maxWidth: 480 }}>
                <h2 style={{ marginBottom: 'var(--sp-2)' }}>⚙️ <span className="grad-text">Settings</span></h2>
                <p style={{ marginBottom: 'var(--sp-8)' }}>All settings are stored locally on your device.</p>

                <div className="glass-card" style={{ padding: 'var(--sp-6)', marginBottom: 'var(--sp-5)' }}>
                    <h3 style={{ marginBottom: 'var(--sp-5)' }}>🛡️ Privacy & Blur</h3>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
                        <div>
                            <div style={{ fontWeight: 500, marginBottom: 4 }}>Blur ON by default</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--clr-text-3)' }}>When you join a room, blur will be auto-enabled</div>
                        </div>
                        <button
                            className={`toggle-btn ${blurDefault ? 'toggle-on' : 'toggle-off'}`}
                            onClick={() => { setBlurDefault(b => !b); save(); }}
                            aria-pressed={blurDefault}
                            style={{ flexShrink: 0, width: 52, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer', position: 'relative', background: blurDefault ? 'var(--clr-success)' : 'var(--clr-text-3)', transition: 'background 0.25s' }}
                        >
                            <span style={{ position: 'absolute', top: 3, width: 22, height: 22, background: '#fff', borderRadius: '50%', transition: 'left 0.25s', left: blurDefault ? 27 : 3, boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }} />
                        </button>
                    </div>
                </div>

                <div className="glass-card" style={{ padding: 'var(--sp-6)', marginBottom: 'var(--sp-5)' }}>
                    <h3 style={{ marginBottom: 'var(--sp-3)' }}>🔔 Notifications</h3>
                    <p style={{ fontSize: '0.875rem', marginBottom: 'var(--sp-4)' }}>Get notified when someone joins your room.</p>
                    {notifPermission === 'granted' ? (
                        <span className="badge badge-on">✅ Notifications enabled</span>
                    ) : (
                        <button className="btn btn-secondary btn-sm" onClick={requestNotif}>
                            Enable Notifications
                        </button>
                    )}
                </div>

                <div className="glass-card" style={{ padding: 'var(--sp-6)' }}>
                    <h3 style={{ marginBottom: 'var(--sp-3)' }}>📱 PWA Install</h3>
                    <p style={{ fontSize: '0.875rem', marginBottom: 'var(--sp-4)' }}>Install Veilcall to your home screen for an app-like experience.</p>
                    <button className="btn btn-secondary btn-sm" id="pwa-install-btn" onClick={() => {
                        const event = (window as unknown as { deferredPWAPrompt?: { prompt: () => void } }).deferredPWAPrompt;
                        if (event) event.prompt();
                        else alert('To install: tap the share button in your browser and select "Add to Home Screen"');
                    }}>
                        📲 Install App
                    </button>
                </div>
            </div>
        </div>
    );
}
