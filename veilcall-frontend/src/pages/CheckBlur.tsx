import React, { useEffect, useRef, useState } from 'react';
import { useFaceBlur, DEFAULT_BLUR_OPTIONS, type BlurMode, type BlurOptions } from '../hooks/useFaceBlur';

export default function CheckBlur() {
    const [options, setOptions] = useState<BlurOptions>(DEFAULT_BLUR_OPTIONS);
    const { videoRef, canvasRef, start, stop, ready, error, facesDetected } = useFaceBlur(options);

    useEffect(() => {
        start();
        return () => stop();
    }, [start, stop]);

    const setOpt = <K extends keyof BlurOptions>(key: K, val: BlurOptions[K]) =>
        setOptions(prev => ({ ...prev, [key]: val }));

    return (
        <div className="check-blur-page page-wrapper">
            <div className="container" style={{ paddingTop: 'var(--sp-10)', maxWidth: 760 }}>
                <a href="/" className="btn btn-ghost btn-sm">← Back</a>
                <h2 style={{ margin: 'var(--sp-5) 0 var(--sp-2)' }}>
                    🎭 <span className="grad-text">Check Your Blur</span>
                </h2>
                <p style={{ marginBottom: 'var(--sp-6)' }}>
                    See exactly what others see during a call. Your face is blurred on-device before anything is transmitted.
                </p>

                {/* Blur status badge — always visible */}
                <div className="blur-status-row">
                    <span className={`blur-status-badge ${options.enabled ? 'blur-badge-on' : 'blur-badge-off'}`}>
                        {options.enabled ? '🛡️ BLUR ACTIVE' : '⚠️ BLUR OFF — YOUR FACE IS VISIBLE'}
                    </span>
                    {ready && <span style={{ fontSize: '0.8rem', color: 'var(--clr-text-3)' }}>Faces detected: {facesDetected}</span>}
                </div>

                {/* Preview */}
                <div className="preview-container glass-card">
                    {error ? (
                        <div className="preview-error">
                            <div style={{ fontSize: '3rem' }}>📷</div>
                            <h3>Camera access needed</h3>
                            <p>{error}</p>
                        </div>
                    ) : (
                        <>
                            {/* Hidden raw video — never shown to user */}
                            <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} aria-hidden="true" />
                            {/* Only show the blurred canvas */}
                            <canvas
                                ref={canvasRef}
                                className="preview-canvas"
                                aria-label={options.enabled ? 'Blurred camera preview' : 'Raw camera preview — blur is off'}
                            />
                            {!ready && (
                                <div className="preview-loading">
                                    <div className="spinner" />
                                    <p>Starting camera…</p>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Controls */}
                <div className="blur-controls-card glass-card">
                    <h3 style={{ marginBottom: 'var(--sp-5)' }}>Blur Settings</h3>

                    {/* ON/OFF */}
                    <div className="control-row">
                        <label className="control-label">Face Blur</label>
                        <button
                            className={`toggle-btn ${options.enabled ? 'toggle-on' : 'toggle-off'}`}
                            onClick={() => setOpt('enabled', !options.enabled)}
                            aria-pressed={options.enabled}
                            id="blur-toggle"
                        >
                            <span className="toggle-thumb" />
                        </button>
                    </div>

                    {/* Mode */}
                    <div className="control-row">
                        <label className="control-label" htmlFor="blur-mode">Blur Mode</label>
                        <div className="mode-select">
                            {(['gaussian', 'pixelate', 'mask'] as BlurMode[]).map(mode => (
                                <button
                                    key={mode}
                                    className={`mode-btn ${options.mode === mode ? 'mode-active' : ''}`}
                                    onClick={() => setOpt('mode', mode)}
                                    aria-pressed={options.mode === mode}
                                >
                                    {mode === 'gaussian' ? '🌫️ Blur' : mode === 'pixelate' ? '🟦 Pixel' : '⬛ Mask'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Strength */}
                    {options.mode !== 'mask' && (
                        <div className="control-row">
                            <label className="control-label" htmlFor="blur-strength">Strength: {options.strength}</label>
                            <input
                                id="blur-strength"
                                type="range"
                                min={2}
                                max={20}
                                value={options.strength}
                                onChange={e => setOpt('strength', Number(e.target.value))}
                                style={{ flex: 1 }}
                            />
                        </div>
                    )}

                    {/* Padding */}
                    <div className="control-row">
                        <label className="control-label" htmlFor="blur-padding">Coverage: {options.padding}px</label>
                        <input
                            id="blur-padding"
                            type="range"
                            min={10}
                            max={80}
                            value={options.padding}
                            onChange={e => setOpt('padding', Number(e.target.value))}
                            style={{ flex: 1 }}
                        />
                    </div>
                </div>
            </div>

            <style>{`
        .check-blur-page { min-height: 100dvh; }
        .blur-status-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--sp-4); flex-wrap: wrap; gap: var(--sp-2); }
        .blur-status-badge {
          display: inline-flex; align-items: center; gap: var(--sp-2);
          padding: 8px 18px; border-radius: var(--rad-full);
          font-family: var(--font-head); font-size: 0.8rem; font-weight: 700;
          letter-spacing: 0.08em;
          animation: pulse-ring 2s infinite;
        }
        .blur-badge-on { background: var(--grad-blur-badge); color: #fff; }
        .blur-badge-off { background: var(--grad-off-badge); color: #fff; animation: none; }
        .preview-container { overflow: hidden; position: relative; min-height: 300px; display: flex; align-items: center; justify-content: center; margin-bottom: var(--sp-5); background: #0a1120; aspect-ratio: 16/9; }
        .preview-canvas { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: var(--rad-xl); }
        .preview-loading { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-4); }
        .preview-error { text-align: center; padding: var(--sp-8); }
        .preview-error h3 { margin: var(--sp-4) 0 var(--sp-2); }
        .blur-controls-card { padding: var(--sp-6); margin-bottom: var(--sp-8); }
        .control-row { display: flex; align-items: center; gap: var(--sp-5); margin-bottom: var(--sp-5); flex-wrap: wrap; }
        .control-label { font-size: 0.875rem; font-weight: 500; min-width: 120px; color: var(--clr-text-2); }
        .toggle-btn { width: 52px; height: 28px; border-radius: 14px; border: none; cursor: pointer; position: relative; transition: background var(--tr-base); flex-shrink: 0; }
        .toggle-on { background: var(--clr-success); }
        .toggle-off { background: var(--clr-text-3); }
        .toggle-thumb { position: absolute; top: 3px; width: 22px; height: 22px; background: #fff; border-radius: 50%; transition: left var(--tr-base); box-shadow: 0 1px 4px rgba(0,0,0,0.4); }
        .toggle-on .toggle-thumb { left: 27px; }
        .toggle-off .toggle-thumb { left: 3px; }
        .mode-select { display: flex; gap: var(--sp-2); }
        .mode-btn { padding: 6px 14px; border-radius: var(--rad-full); border: 1px solid var(--clr-border-2); background: var(--clr-surface); color: var(--clr-text-2); font-size: 0.8rem; font-family: var(--font-head); cursor: pointer; transition: all var(--tr-fast); }
        .mode-btn:hover { border-color: var(--clr-primary); color: var(--clr-text); }
        .mode-active { background: rgba(99,102,241,0.2) !important; border-color: var(--clr-primary) !important; color: var(--clr-primary-light) !important; }
      `}</style>
        </div>
    );
}
