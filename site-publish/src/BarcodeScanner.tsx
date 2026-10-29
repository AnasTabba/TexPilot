import { useEffect, useRef, useState } from 'react';
import { Camera, Upload, ScanLine, Square, Search } from 'lucide-react';
import type { IScannerControls } from '@zxing/browser';

export default function BarcodeScanner({ onFound }: { onFound: (code: string) => Promise<void> }) {
  const [active, setActive] = useState(false);
  const [opening, setOpening] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
    reading.current = true; stop(); setCode(value); setBusy(true); setError('');
    try { await onFoundRef.current(value.trim()); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not find this barcode.'); }
    finally { reading.current = false; setBusy(false); }
  }
  async function start() {
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('The camera needs the HTTPS app URL. You can also upload a barcode photo or type its code.'); return;
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
        ? 'Camera permission was denied. Allow Camera for this site in Safari settings, or upload a photo.'
        : 'The camera could not start. Close other camera apps, try again, or upload a barcode photo.');
    }
  }
  async function photo(file: File | undefined) {
    if (!file) return;
    stop(); setError(''); setBusy(true);
    if (file.size > 12 * 1024 * 1024) { setBusy(false); setError('Choose a barcode photo smaller than 12 MB.'); return; }
    const url = URL.createObjectURL(file);
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const result = await new BrowserMultiFormatReader().decodeFromImageUrl(url);
      setBusy(false); await lookup(result.getText());
    } catch { setError('No readable barcode found. Try a sharp JPEG/PNG photo with the entire code visible, or type the code.'); }
    finally { URL.revokeObjectURL(url); setBusy(false); }
  }
  return <section className="live-panel barcode-panel" aria-label="Barcode scanner">
    <div className="live-panel-heading"><ScanLine aria-hidden="true" /><div><h2>Find a batch by its label</h2><p>Scan a Yarnflow QR label, a product barcode, or enter a batch number.</p></div></div>
    <div className={`barcode-view ${active ? 'is-active' : ''}`}>
      <video ref={video} autoPlay muted playsInline aria-label="Barcode camera preview" hidden={!active} />
      {!active && <div><ScanLine size={48} aria-hidden="true" /><p>Keep the whole code inside the camera view.</p></div>}
      {opening && <span className="barcode-opening" role="status">Opening camera…</span>}
    </div>
    <div className="live-actions">
      {active ? <button className="button" onClick={stop}><Square size={18} />Stop camera</button> : <button className="button primary" onClick={() => void start()} disabled={busy || opening}><Camera size={18} />Open barcode camera</button>}
      <label className="button live-upload"><Upload size={18} />Read barcode photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event => { void photo(event.target.files?.[0]); event.target.value = ''; }} disabled={busy} /></label>
    </div>
    <form onSubmit={event => { event.preventDefault(); void lookup(code); }} className="barcode-code-form">
      <label htmlFor="barcode-code">Barcode or batch number</label>
      <div><input id="barcode-code" value={code} onChange={event => setCode(event.target.value)} autoCapitalize="off" autoCorrect="off" maxLength={200} required /><button className="button" disabled={busy || !code.trim()}><Search size={18} />{busy ? 'Finding…' : 'Find batch'}</button></div>
    </form>
    {error && <p className="live-error" role="alert">{error}</p>}
  </section>;
}
