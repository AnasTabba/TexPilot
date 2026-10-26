import { useEffect, useRef, useState } from 'react';
import { Camera, Upload, ScanLine, Square, Search } from 'lucide-react';
import type { IScannerControls } from '@zxing/browser';
import { useLanguage } from './i18n';

export default function BarcodeScanner({ onFound }: { onFound: (code: string) => Promise<void> }) {
  const { t } = useLanguage();
  const [active, setActive] = useState(false);
  const [opening, setOpening] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
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
    reading.current = true; stop(); setCode(value); setBusy(true); setError(null);
    try { await onFoundRef.current(value.trim()); }
    catch (error) { setError(error instanceof Error ? { english: error.message } : { english: 'Could not find this barcode.', urdu: 'یہ بارکوڈ نہیں ملا۔' }); }
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
    if (file.size > 12 * 1024 * 1024) { setBusy(false); setError({ english: 'Choose a barcode photo smaller than 12 MB.', urdu: 'بارکوڈ کی تصویر 12 MB سے چھوٹی ہونی چاہیے۔' }); return; }
    const url = URL.createObjectURL(file);
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const result = await new BrowserMultiFormatReader().decodeFromImageUrl(url);
      setBusy(false); await lookup(result.getText());
    } catch { setError({ english: 'No readable barcode found. Try a sharp JPEG/PNG photo with the entire code visible, or type the code.', urdu: 'بارکوڈ پڑھا نہیں جا سکا۔ واضح JPEG/PNG تصویر دیں جس میں پورا کوڈ نظر آئے، یا کوڈ لکھیں۔' }); }
    finally { URL.revokeObjectURL(url); setBusy(false); }
  }
  return <section className="live-panel barcode-panel" aria-label={t('Barcode scanner', 'بارکوڈ اسکینر')}>
    <div className="live-panel-heading"><ScanLine aria-hidden="true" /><div><h2>{t('Find a batch by its label', 'لیبل سے بیچ تلاش کریں')}</h2><p>{t('Scan a Yarnflow QR label, a product barcode, or enter a batch number.', 'Yarnflow کا QR لیبل یا پروڈکٹ بارکوڈ اسکین کریں، یا بیچ نمبر درج کریں۔')}</p></div></div>
    <div className={`barcode-view ${active ? 'is-active' : ''}`}>
      <video ref={video} autoPlay muted playsInline aria-label={t('Barcode camera preview', 'بارکوڈ کیمرے کا منظر')} hidden={!active} />
      {!active && <div><ScanLine size={48} aria-hidden="true" /><p>{t('Keep the whole code inside the camera view.', 'پورا کوڈ کیمرے کے اندر رکھیں۔')}</p></div>}
      {opening && <span className="barcode-opening" role="status">{t('Opening camera…', 'کیمرہ کھل رہا ہے…')}</span>}
    </div>
    <div className="live-actions">
      {active ? <button className="button" onClick={stop}><Square size={18} />{t('Stop camera', 'کیمرہ بند کریں')}</button> : <button className="button primary" onClick={() => void start()} disabled={busy || opening}><Camera size={18} />{t('Open barcode camera', 'بارکوڈ کیمرہ کھولیں')}</button>}
      <label className="button live-upload"><Upload size={18} />{t('Read barcode photo', 'بارکوڈ کی تصویر پڑھیں')}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event => { void photo(event.target.files?.[0]); event.target.value = ''; }} disabled={busy} /></label>
    </div>
    <form onSubmit={event => { event.preventDefault(); void lookup(code); }} className="barcode-code-form">
      <label htmlFor="barcode-code">{t('Barcode or batch number', 'بارکوڈ یا بیچ نمبر')}</label>
      <div><input id="barcode-code" dir="ltr" value={code} onChange={event => setCode(event.target.value)} autoCapitalize="off" autoCorrect="off" maxLength={200} required /><button className="button" disabled={busy || !code.trim()}><Search size={18} />{busy ? t('Finding…', 'تلاش ہو رہا ہے…') : t('Find batch', 'بیچ تلاش کریں')}</button></div>
    </form>
    {error && <p className="live-error" role="alert">{t(error.english, error.urdu)}</p>}
  </section>;
}
