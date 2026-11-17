import { useState } from 'react';
import { Languages, Moon, Sun, Laptop } from 'lucide-react';
import { useLanguage } from './i18n';
import { ChoiceTiles, Section } from './ui';

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
  const { t, language, setLanguage } = useLanguage();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const choose = (next: Theme) => { setTheme(next); saveTheme(next); };
  return <div className="yf-app-settings">
    <Section title={t('Appearance', 'ظاہری شکل')}>
      <ChoiceTiles label={t('Choose appearance', 'ظاہری شکل منتخب کریں')} value={theme} onChange={v => choose(v as Theme)} options={options.map(([value,label,urdu],i) => ({value,title:t(label,urdu),icon:[<Sun/>,<Moon/>,<Laptop/>][i]}))} />
    </Section>
    <Section title={t('Language', 'زبان')}>
      <ChoiceTiles label={t('Choose a language', 'زبان منتخب کریں')} value={language} onChange={v => setLanguage(v as 'en'|'ur')} options={[{value:'en',title:'English',icon:<Languages/>},{value:'ur',title:'اردو',icon:<Languages/>}]} />
    </Section>
  </div>;
}
