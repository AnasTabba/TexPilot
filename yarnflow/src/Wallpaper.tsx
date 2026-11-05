import './wallpaper.css';
import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Upload, X } from 'lucide-react';
import { useLanguage } from './i18n';
import { applyWallpaper, readWallpaper, saveWallpaper, wallpaperImage, WALLPAPERS, type WallpaperPrefs } from './wallpaper-store';

export function WallpaperButton() {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const [prefs, setPrefs] = useState(readWallpaper);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'saved' | 'storage' | 'invalid' | 'failed'>('saved');
  useEffect(() => () => { request.current++; }, []);
  const choose = (next: WallpaperPrefs) => {
    setPrefs(next);
    applyWallpaper(next);
    setStatus(saveWallpaper(next) ? 'saved' : 'storage');
  };
  const upload = async (file: File) => {
    if (!file.type.startsWith('image/')) { setStatus('invalid'); return; }
    const current = ++request.current;
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      let custom: string;
      try {
        const canvas = document.createElement('canvas');
        const encode = (edge: number, quality: number) => {
          const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas unavailable');
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const result = canvas.toDataURL('image/jpeg', quality);
          if (!result.startsWith('data:image/')) throw new Error('Image encoding failed');
          return result;
        };
        custom = encode(2400, 0.8);
        if (custom.length > 3_500_000) custom = encode(1600, 0.72);
      } finally { bitmap.close(); }
      if (current === request.current) choose({ ...prefs, id: 'custom', custom });
    } catch {
      if (current === request.current) setStatus('failed');
    } finally {
      if (current === request.current) setBusy(false);
    }
  };
  const message = busy ? t('Preparing photo…', 'تصویر تیار ہو رہی ہے…')
    : status === 'storage' ? t('This photo is too large to keep on this device; it shows until you reload.', 'یہ تصویر اس آلے پر محفوظ کرنے کے لیے بہت بڑی ہے؛ صفحہ دوبارہ لوڈ ہونے تک نظر آئے گی۔')
    : status === 'invalid' ? t('Choose an image file.', 'تصویر کی فائل منتخب کریں۔')
    : status === 'failed' ? t('Could not prepare this photo. Try another image.', 'یہ تصویر تیار نہیں ہو سکی۔ کوئی اور تصویر آزمائیں۔')
    : t('Saved on this device only.', 'یہ ترتیب صرف اس آلے پر محفوظ ہوتی ہے۔');
  return <>
    <button type="button" className="yf-wall-edit" aria-label={t('Change wallpaper', 'پس منظر تبدیل کریں')} title={t('Change wallpaper', 'پس منظر تبدیل کریں')} aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}><ImageIcon size={20} aria-hidden="true" /></button>
    <dialog ref={dialog} className="yf-wall-sheet" aria-labelledby="yf-wall-title" onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
    }}>
      <div className="yf-wall-head"><h2 id="yf-wall-title">{t('Wallpaper', 'پس منظر')}</h2><button type="button" className="live-icon-button" aria-label={t('Close', 'بند کریں')} onClick={() => dialog.current?.close()}><X aria-hidden="true" /></button></div>
      <div className="yf-wall-grid" role="group" aria-label={t('Wallpapers', 'پس منظر کی تصاویر')} aria-busy={busy}>
        <button type="button" className="yf-wall-swatch" aria-pressed={prefs.id === 'none'} disabled={busy} onClick={() => choose({ ...prefs, id: 'none' })}><span className="yf-wall-thumb is-none" /><span>{t('Plain sheet', 'سادہ پس منظر')}</span></button>
        {WALLPAPERS.map(p => <button type="button" key={p.id} className="yf-wall-swatch" aria-pressed={prefs.id === p.id} disabled={busy} onClick={() => choose({ ...prefs, id: p.id })}><span className="yf-wall-thumb" style={{ backgroundImage: p.image }} /><span>{t(p.en, p.ur)}</span></button>)}
        {prefs.custom && <button type="button" className="yf-wall-swatch" aria-pressed={prefs.id === 'custom'} disabled={busy} onClick={() => choose({ ...prefs, id: 'custom' })}><span className="yf-wall-thumb" style={{ backgroundImage: wallpaperImage({ ...prefs, id: 'custom' }) ?? undefined }} /><span>{t('Your photo', 'آپ کی تصویر')}</span></button>}
        <label className="yf-wall-swatch is-upload"><span className="yf-wall-thumb is-upload"><Upload aria-hidden="true" /></span><span>{t('Upload photo', 'تصویر اپ لوڈ کریں')}</span><input type="file" accept="image/*" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: 0 }} disabled={busy} onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void upload(file);
        }} /></label>
      </div>
      <label className="yf-wall-dim"><span>{t('Soften', 'نرم کریں')}</span><input type="range" min="0" max="0.7" step="0.05" value={prefs.dim} disabled={busy || prefs.id === 'none'} onChange={event => choose({ ...prefs, dim: Number(event.currentTarget.value) })} /></label>
      <p className="live-muted" role="status">{message}</p>
    </dialog>
  </>;
}
