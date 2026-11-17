import { useEffect, useRef, useState } from 'react';
import { Camera, Upload, ScanLine, Square, Search, TriangleAlert } from 'lucide-react';
import type { IScannerControls } from '@zxing/browser';
import { useLanguage } from './i18n';
import { InventoryError } from './inventory-client';
import { RowCard } from './ui';
import './spec-scan.css';

/** Phone photos can be larger than the reader needs: draw them at most 2000 px on the long side first. */
async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/png');
}

export default function BarcodeScanner({ onFound }: { onFound: (code: string) => Promise<void> }) {
  const { t } = useLanguage();
  const [active, setActive] = useState(false);
  const [opening, setOpening] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState(false);
  const [error, setError] = useState<{ english: string; urdu?: string } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const generation = useRef(0);
  const reading = useRef(false);
  const onFoundRef = useRef(onFound);
  onFoundRef.current = onFound;
  function stop() {
    generation.current++;
    controls.current?.stop(); controls.current = null;
    const stream = video.current?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
    if (video.current) video.current.srcObject = null;
    setActive(false); setOpening(false);
  }
  useEffect(() => {
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { generation.current++; controls.current?.stop(); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  async function lookup(value: string) {
    if (reading.current) return;
    reading.current = true; stop(); setCode(value); setBusy(true); setError(null); setFound(false);
    try { await onFoundRef.current(value.trim()); setFound(true); }
    catch (error) {
      console.error(error);
      setError(error instanceof InventoryError && error.status === 404
        ? { english: 'No batch has this code. Check the code, or add the batch first.', urdu: 'اس کوڈ کا کوئی بیچ نہیں ملا۔ کوڈ جانچیں، یا پہلے بیچ شامل کریں۔' }
        : { english: 'Could not look up this batch. Check the connection and try again.', urdu: 'اس بیچ کی تلاش نہیں ہو سکی۔ انٹرنیٹ جانچ کر دوبارہ کوشش کریں۔' });
    }
    finally { reading.current = false; setBusy(false); }
  }
  async function start() {
    setError(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError({ english: 'The camera needs the HTTPS app URL. You can also upload a barcode photo or type its code.', urdu: 'کیمرے کے لیے ایپ کا HTTPS پتہ درکار ہے۔ بارکوڈ کی تصویر اپ لوڈ کریں یا کوڈ لکھیں۔' }); return;
    }
    stop(); const attempt = ++generation.current; setOpening(true); setActive(true);
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      if (attempt !== generation.current || !video.current) return;
      const reader = new BrowserMultiFormatReader();
      const session = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false }, video.current,
        (result, _error, session) => {
          if (result && attempt === generation.current && !reading.current) { session.stop(); void lookup(result.getText()); }
        });
      if (attempt !== generation.current) { session.stop(); return; }
      controls.current = session; setOpening(false);
    } catch (error) {
      if (attempt !== generation.current) return;
      stop(); setError(error instanceof DOMException && error.name === 'NotAllowedError'
        ? { english: 'Camera permission was denied. Allow Camera for this site in Safari settings, or upload a photo.', urdu: 'کیمرے کی اجازت نہیں ملی۔ Safari کی سیٹنگز میں اس سائٹ کو کیمرے کی اجازت دیں، یا تصویر اپ لوڈ کریں۔' }
        : { english: 'The camera could not start. Close other camera apps, try again, or upload a barcode photo.', urdu: 'کیمرہ شروع نہیں ہو سکا۔ دوسری کیمرہ ایپس بند کرکے دوبارہ کوشش کریں، یا بارکوڈ کی تصویر اپ لوڈ کریں۔' });
    }
  }
  async function photo(file: File | undefined) {
    if (!file) return;
    stop(); setError(null); setBusy(true);
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const result = await new BrowserMultiFormatReader().decodeFromImageUrl(await downscale(file));
      setBusy(false); await lookup(result.getText());
    } catch { setError({ english: 'No readable barcode found. Try a sharp JPEG/PNG photo with the entire code visible, or type the code.', urdu: 'بارکوڈ پڑھا نہیں جا سکا۔ واضح JPEG/PNG تصویر دیں جس میں پورا کوڈ نظر آئے، یا کوڈ لکھیں۔' }); }
    finally { setBusy(false); }
  }
  return <section className="live-panel barcode-panel" aria-label={t('Barcode scanner', 'بارکوڈ اسکینر')}>
    <div className="live-panel-heading"><div><h2>{t('Stock label', 'اسٹاک لیبل')}</h2></div></div>
    <form onSubmit={event => { event.preventDefault(); void lookup(code); }} className="barcode-code-form">
      <label htmlFor="barcode-code">{t('Or type the code', 'یا کوڈ لکھیں')}</label>
      <div><input id="barcode-code" dir="ltr" value={code} onChange={event => setCode(event.target.value)} autoCapitalize="off" autoCorrect="off" maxLength={200} required /><button className="button primary" disabled={busy || !code.trim()}><Search size={18} />{busy ? t('Finding…', 'تلاش ہو رہا ہے…') : t('Find batch', 'بیچ تلاش کریں')}</button></div>
    </form>
    <div className={`barcode-view ${active ? 'is-active' : ''}`}>
      <video ref={video} autoPlay muted playsInline aria-label={t('Barcode camera preview', 'بارکوڈ کیمرے کا منظر')} hidden={!active} />
      {!active && <div><ScanLine size={48} aria-hidden="true" /><p>{t('Camera ready', 'کیمرہ تیار ہے')}</p></div>}
      {opening && <span className="barcode-opening" role="status">{t('Opening camera…', 'کیمرہ کھل رہا ہے…')}</span>}
    </div>
    <div className="live-actions">
      {active ? <button className="button" onClick={stop}><Square size={18} />{t('Stop camera', 'کیمرہ بند کریں')}</button> : <button className="button" onClick={() => void start()} disabled={busy || opening}><Camera size={18} />{t('Scan label', 'لیبل اسکین کریں')}</button>}
      <label className="button live-upload"><Upload size={18} />{t('Read barcode photo', 'بارکوڈ کی تصویر پڑھیں')}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event => { void photo(event.target.files?.[0]); event.target.value = ''; }} disabled={busy} /></label>
    </div>
    {found && <div className="barcode-found" role="status"><RowCard leading={<ScanLine aria-hidden="true" />} title={t('Code found', 'کوڈ مل گیا')} detail={t('Open the matching batch below.', 'متعلقہ بیچ نیچے کھولیں۔')} /></div>}
    {error && <div className="barcode-error-wrap"><p className="live-error barcode-error" role="alert"><TriangleAlert size={18} aria-hidden="true" /> {t(error.english, error.urdu)}</p><button className="button" type="button" onClick={() => void lookup(code)} disabled={!code.trim() || busy}><Search size={18} />{t('Try again', 'دوبارہ کوشش کریں')}</button></div>}
  </section>;
}
