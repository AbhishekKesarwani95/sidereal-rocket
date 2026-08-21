import React from 'react';
import { NavLink } from 'react-router-dom';

const navItems = [
    { to: '/', icon: '🏠', label: 'Home' },
    { to: '/random', icon: '🎲', label: 'Random' },
    { to: '/host', icon: '👑', label: 'Host' },
    { to: '/profile', icon: '👤', label: 'Profile' },
    { to: '/settings', icon: '⚙️', label: 'Settings' },
];

export default function Navbar() {
    return (
        <nav className="bottom-nav" aria-label="Main navigation">
            {navItems.map(item => (
                <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}
                    aria-label={item.label}
                >
                    <span className="nav-icon">{item.icon}</span>
                    <span className="nav-label">{item.label}</span>
                </NavLink>
            ))}
            <style>{`
        .bottom-nav {
          position: fixed;
          bottom: 0; left: 0; right: 0;
          height: var(--bottom-nav-h);
          background: var(--glass-bg);
          backdrop-filter: var(--glass-blur);
          -webkit-backdrop-filter: var(--glass-blur);
          border-top: 1px solid var(--clr-border);
          display: flex;
          align-items: center;
          justify-content: space-around;
          z-index: 1000;
          padding-bottom: env(safe-area-inset-bottom, 0);
        }
        .nav-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 8px 16px;
          border-radius: var(--rad-lg);
          color: var(--clr-text-3);
          text-decoration: none;
          transition: all var(--tr-fast);
          -webkit-tap-highlight-color: transparent;
          flex: 1;
        }
        .nav-item:hover { color: var(--clr-text-2); }
        .nav-item:focus-visible { outline: 2px solid var(--clr-primary-light); outline-offset: -2px; border-radius: var(--rad-md); }
        .nav-item-active { color: var(--clr-primary-light) !important; }
        .nav-item-active .nav-icon {
          background: rgba(99,102,241,0.15);
          border-radius: var(--rad-full);
        }
        .nav-icon { font-size: 1.4rem; padding: 4px 8px; transition: background var(--tr-fast); }
        .nav-label { font-size: 0.65rem; font-family: var(--font-head); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
      `}</style>
        </nav>
    );
}
