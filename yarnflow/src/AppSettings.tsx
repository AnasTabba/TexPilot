import { useState } from 'react';
import { LanguageSelect, useLanguage } from './i18n';

/** Per-device app preferences. 'system' follows the device's light or dark setting. */
export type Theme = 'light' | 'dark' | 'system';
const themeKey = 'yarnflow-theme';
const darkQuery = '(prefers-color-scheme: dark)';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(themeKey);
    return stored === 'dark' || stored === 'system' ? stored : 'light';
  } catch { return 'light'; }
}

// Only one device-theme listener at a time, however often the theme changes.
let stopFollowingDevice: (() => void) | undefined;

/** Sets data-theme on <html> to the resolved theme and keeps 'system' in step with the device. */
export function applyTheme(theme: Theme) {
  stopFollowingDevice?.();
  stopFollowingDevice = undefined;
  const root = document.documentElement;
  const canMatch = typeof matchMedia === 'function';
  const set = () => { root.dataset.theme = theme === 'system' ? (canMatch && matchMedia(darkQuery).matches ? 'dark' : 'light') : theme; };
  set();
  if (theme === 'system' && canMatch) {
    const query = matchMedia(darkQuery);
    query.addEventListener('change', set);
    stopFollowingDevice = () => query.removeEventListener('change', set);
  }
}

/** Call once before the first render so the saved theme applies with no flash. */
export function applyStoredTheme() { applyTheme(readTheme()); }

function saveTheme(theme: Theme) {
  try { localStorage.setItem(themeKey, theme); } catch { /* The theme still applies for this visit. */ }
  applyTheme(theme);
}

const options: [Theme, string, string][] = [
  ['light', 'Light', 'روشن'],
  ['dark', 'Dark', 'گہرا'],
  ['system', 'Match device', 'آلے کے مطابق'],
];

export default function AppSettings() {
  const { t } = useLanguage();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const choose = (next: Theme) => { setTheme(next); saveTheme(next); };
  return <div className="yf-app-settings">
    <section className="live-panel">
      <h2>{t('Appearance', 'ظاہری شکل')}</h2>
      <fieldset className="yf-theme">
        <legend className="control-label">{t('Appearance', 'ظاہری شکل')}</legend>
        <div className="yf-theme-options">
          {options.map(([value, label, urdu]) => <label key={value} className={theme === value ? 'is-on' : undefined}>
            <input type="radio" name="yf-theme" value={value} checked={theme === value} onChange={() => choose(value)} />
            <span>{t(label, urdu)}</span>
          </label>)}
        </div>
      </fieldset>
      <p className="live-muted">{t('Saved on this device only.', 'یہ ترتیب صرف اس آلے پر محفوظ ہوتی ہے۔')}</p>
    </section>
    <section className="live-panel yf-language-settings">
      <h2>{t('Language', 'زبان')}</h2>
      <LanguageSelect />
    </section>
  </div>;
}
