export type WallpaperId = 'none' | 'dusk' | 'indigo' | 'cotton' | 'madder' | 'garden' | 'dune' | 'custom';
export interface WallpaperPrefs { id: WallpaperId; dim: number; custom?: string }
export interface Preset { id: Exclude<WallpaperId, 'none' | 'custom'>; en: string; ur: string; image: string }

export const WALLPAPERS: Preset[] = [
  { id: 'dusk', en: 'Loom dusk', ur: 'شامِ کرگھا', image: 'radial-gradient(120% 90% at 85% 10%, #e9a66b 0%, transparent 55%), radial-gradient(90% 80% at 10% 90%, #3b2a5a 0%, transparent 60%), radial-gradient(70% 60% at 40% 40%, #b2593f 0%, transparent 65%), linear-gradient(160deg, #2a1d2e, #120d14)' },
  { id: 'indigo', en: 'Indigo vat', ur: 'نیل کا حوض', image: 'radial-gradient(100% 80% at 20% 15%, #4f6fd6 0%, transparent 55%), radial-gradient(80% 70% at 90% 85%, #1c2c6b 0%, transparent 60%), radial-gradient(60% 50% at 70% 30%, #8fa7e8 0%, transparent 60%), linear-gradient(200deg, #0d1430, #070a18)' },
  { id: 'cotton', en: 'Raw cotton', ur: 'کچی کپاس', image: 'radial-gradient(110% 90% at 80% 0%, #fffaf0 0%, transparent 60%), radial-gradient(90% 70% at 0% 100%, #e6d6b8 0%, transparent 60%), radial-gradient(60% 60% at 50% 50%, #f1e4cc 0%, transparent 70%), linear-gradient(170deg, #efe5d2, #d9c7a6)' },
  { id: 'madder', en: 'Madder red', ur: 'مجیٹھ', image: 'radial-gradient(110% 80% at 80% 15%, #f08a5d 0%, transparent 55%), radial-gradient(90% 80% at 15% 85%, #6d1a22 0%, transparent 60%), radial-gradient(60% 55% at 45% 45%, #c2412f 0%, transparent 65%), linear-gradient(165deg, #3a1015, #1a0709)' },
  { id: 'garden', en: 'Mill garden', ur: 'مل کا باغ', image: 'radial-gradient(100% 80% at 85% 10%, #c9c27a 0%, transparent 55%), radial-gradient(90% 80% at 10% 90%, #22382a 0%, transparent 60%), radial-gradient(65% 55% at 40% 40%, #6f8f5b 0%, transparent 65%), linear-gradient(160deg, #1d2a1f, #0d140f)' },
  { id: 'dune', en: 'Desert dune', ur: 'ریگستانی ٹیلہ', image: 'radial-gradient(120% 90% at 20% 0%, #f6d7a7 0%, transparent 55%), radial-gradient(90% 80% at 90% 90%, #9a5b34 0%, transparent 60%), radial-gradient(70% 60% at 60% 40%, #d99a5b 0%, transparent 65%), linear-gradient(175deg, #e3b98a, #7a4528)' },
];
export const DEFAULT_WALLPAPER: WallpaperPrefs = { id: 'none', dim: 0.2 };
const wallpaperKey = 'yarnflow-wallpaper';

export function readWallpaper(): WallpaperPrefs {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(wallpaperKey) ?? 'null');
    if (!value || typeof value !== 'object') return { ...DEFAULT_WALLPAPER };
    const { id, dim, custom } = value as Record<string, unknown>;
    if (id !== 'none' && id !== 'custom' && !WALLPAPERS.some(p => p.id === id)) return { ...DEFAULT_WALLPAPER };
    if (id === 'custom' && (typeof custom !== 'string' || !custom.startsWith('data:image/'))) return { ...DEFAULT_WALLPAPER };
    return {
      id: id as WallpaperId,
      dim: typeof dim === 'number' && Number.isFinite(dim) ? Math.min(0.7, Math.max(0, dim)) : DEFAULT_WALLPAPER.dim,
      ...(typeof custom === 'string' && custom.startsWith('data:image/') ? { custom } : {}),
    };
  } catch { return { ...DEFAULT_WALLPAPER }; }
}

export function saveWallpaper(p: WallpaperPrefs): boolean {
  try { localStorage.setItem(wallpaperKey, JSON.stringify(p)); return true; }
  catch { return false; }
}

export function wallpaperImage(p: WallpaperPrefs): string | null {
  if (p.id === 'custom') return p.custom?.startsWith('data:image/') ? `url("${p.custom.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ').replace(/\r/g, '\\d ').replace(/\f/g, '\\c ')}")` : null;
  return WALLPAPERS.find(preset => preset.id === p.id)?.image ?? null;
}

export function applyWallpaper(p: WallpaperPrefs): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const image = wallpaperImage(p);
  if (image) {
    root.style.setProperty('--yf-wallpaper', image);
    root.style.setProperty('--yf-wallpaper-dim', String(p.dim));
    root.dataset.wallpaper = p.id === 'custom' ? 'photo' : 'preset';
  } else {
    root.style.removeProperty('--yf-wallpaper');
    root.style.removeProperty('--yf-wallpaper-dim');
    delete root.dataset.wallpaper;
  }
}

export function applyStoredWallpaper(): void { applyWallpaper(readWallpaper()); }
