import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Boxes, Check, Download, LockKeyhole, ScanLine, ShieldCheck } from 'lucide-react';

const KEY='yf-pin-v1';
async function digest(pin:string,salt:string,mode?:'local') {
  // The PIN is a convenience lock for a browser-stored MVP; inventory is not encrypted.
  if (!crypto.subtle || mode==='local') {
    let value=2166136261;
    for(const char of `${salt}:${pin}`){value^=char.charCodeAt(0);value=Math.imul(value,16777619);}
    return `local:${(value>>>0).toString(16)}`;
  }
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
  const bytes=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:120000,hash:'SHA-256'},material,256);
  return `pbkdf2:${Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('')}`;
}

function readPin():{salt:string;hash:string}|null {try {const value=localStorage.getItem(KEY);return value?JSON.parse(value):null;}catch{return null;}}
export function SignInPage({onEnter}:{onEnter:()=>void}) {
  const [saved,setSaved]=useState(readPin);
  const [pin,setPin]=useState('');const [confirm,setConfirm]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const setup=!saved;
  async function submit(event:FormEvent) {
    event.preventDefault();setError('');
    if(!/^\d{4}$/.test(pin)){setError('Enter exactly four digits.');return;}
    if(setup&&pin!==confirm){setError('The two PINs do not match.');return;}
    setBusy(true);
    try {
      if(setup){const salt=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');const value={salt,hash:await digest(pin,salt)};localStorage.setItem(KEY,JSON.stringify(value));setSaved(value);}
      else if(await digest(pin,saved.salt,saved.hash.startsWith('local:')?'local':undefined)!==saved.hash){setError('Incorrect PIN. Try again.');setPin('');return;}
      sessionStorage.setItem('yf-pin-session','1');location.hash='/overview';onEnter();
    } catch(error){setError(error instanceof Error?error.message:'Could not save the PIN on this device.');}
    finally{setBusy(false);}
  }
  return <main className="mvp-login"><section className="mvp-login-story"><div className="mvp-wordmark"><img src="/brand/logo.png" width="42" height="42" alt=""/>yarnflow.</div><div><span className="mvp-eyebrow">FACTORY WORKSPACE</span><h1>Know what you have.<br/>Keep work moving.</h1><p>Inventory, batch quality, and material scanning in one clear workspace.</p><div className="mvp-login-steps"><span><Boxes aria-hidden="true"/>Track stock and batches <Check aria-hidden="true"/></span><span><ShieldCheck aria-hidden="true"/>Review quality before dispatch <Check aria-hidden="true"/></span><span><ScanLine aria-hidden="true"/>Scan with TexPilot <Check aria-hidden="true"/></span></div></div><p>Yarnflow MVP</p></section><section className="mvp-login-form"><form onSubmit={submit}><span className="mvp-login-lock"><LockKeyhole aria-hidden="true"/></span><h2>{setup?'Set your PIN':'Welcome back'}</h2><p>{setup?'Choose a four-digit PIN for this device. Inventory is saved in this browser and is not encrypted.':'Enter the PIN you set on this device to open your inventory.'}</p><label htmlFor="mvp-pin">{setup?'Create a 4-digit PIN':'Your 4-digit PIN'}</label><input id="mvp-pin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete={setup?'new-password':'current-password'} value={pin} onChange={event=>{setPin(event.target.value.replace(/\D/g,''));setError('');}} required autoFocus/>{setup&&<><label htmlFor="mvp-confirm">Confirm PIN</label><input id="mvp-confirm" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="new-password" value={confirm} onChange={event=>{setConfirm(event.target.value.replace(/\D/g,''));setError('');}} required/></>}{error&&<p className="mvp-login-error" role="alert">{error}</p>}<button disabled={busy} className="mvp-login-submit">{busy?'Checking…':setup?'Save PIN and open workspace':'Open workspace'}<ArrowRight size={20} aria-hidden="true"/></button><div className="mvp-login-note"><Download size={19} aria-hidden="true"/><span>Inventory stays on this device. Export a backup regularly. Scanning requires the TexPilot service.</span></div></form></section></main>;
}
export default function AccessGate({children}:{children:ReactNode}) {
  const [entered,setEntered]=useState(()=>{try{return sessionStorage.getItem('yf-pin-session')==='1'&&!!readPin()&&location.hash!=='#/login';}catch{return false;}});
  useEffect(()=>{const update=()=>{if(location.hash==='#/login'){sessionStorage.removeItem('yf-pin-session');setEntered(false);}};addEventListener('hashchange',update);return()=>removeEventListener('hashchange',update);},[]);
  return entered?children:<SignInPage onEnter={()=>setEntered(true)}/>;
}
