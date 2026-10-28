import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Globe2 } from 'lucide-react';
import { copy } from './ui-copy';
import { urdu } from './translations';

export type Language = 'en' | 'ur';
const storageKey = 'yf-language';
// Reuse the scanner's existing, explicitly paired English/Urdu copy.
const scannerUrdu: Record<string, string> = {};
let previous = '';
for (const [key, value] of Object.entries(copy)) {
  if (typeof value !== 'string') { previous = ''; continue; }
  if (key.startsWith('urdu') || key.endsWith('Ur')) {
    if (previous) scannerUrdu[previous] = value;
  } else previous = value;
}

export function translate(language: Language, english: string, translation?: string): string {
  return language === 'ur' ? translation || urdu[english] || scannerUrdu[english] || english : english;
}

type LanguageState = { language: Language; setLanguage: (language: Language) => void; t: (english: string, urdu?: string) => string };
const LanguageContext = createContext<LanguageState>({ language: 'en', setLanguage: () => {}, t: english => english });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, update] = useState<Language>(() => {
    try { return localStorage.getItem(storageKey) === 'ur' ? 'ur' : 'en'; } catch { return 'en'; }
  });
  const setLanguage = useCallback((next: Language) => {
    update(next);
    try { localStorage.setItem(storageKey, next); } catch { /* The language still works for this visit. */ }
  }, []);
  useLayoutEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ur' ? 'rtl' : 'ltr';
  }, [language]);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === storageKey) update(event.newValue === 'ur' ? 'ur' : 'en'); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const t = useCallback((english: string, urdu?: string) => translate(language, english, urdu), [language]);
  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);

export function LanguageSelect() {
  const { language, setLanguage } = useLanguage();
  const next = language === 'en' ? 'ur' : 'en';
  const label = next === 'ur' ? 'Switch language to Urdu / اردو' : 'Switch language to English / انگریزی';
  return <button type="button" className="yf-language" dir="ltr" aria-label={label} title={label} onClick={() => setLanguage(next)}>
    <Globe2 size={21} aria-hidden="true" />
  </button>;
}
