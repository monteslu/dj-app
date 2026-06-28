/**
 * AppearanceSettings — the "Appearance" preferences tab. Pick a color theme; the choice
 * applies live (data-theme on .app) and persists (localStorage). Themes are defined in
 * theme.ts + styles.css token blocks.
 */

import { THEMES, useTheme } from '../theme.js';

export function AppearanceSettings(): React.JSX.Element {
  const [themeId, setThemeId] = useTheme();

  return (
    <div className="prefs-panel">
      <h3>Theme</h3>
      <p className="prefs-note" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
        Choose a color scheme. Applies instantly and is remembered.
      </p>

      <div className="theme-grid">
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={`theme-card${t.id === themeId ? ' active' : ''}`}
            onClick={() => setThemeId(t.id)}
            title={t.label}
          >
            <span className="theme-swatch" style={{ background: t.swatch }} />
            <span className="theme-name">{t.label}</span>
            {t.id === themeId && <span className="theme-check">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
