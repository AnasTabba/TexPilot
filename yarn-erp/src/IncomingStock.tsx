import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { AsyncForm, Field, errorMessage } from './forms';
import { can, inventoryRequest as api, type Member, type Product } from './inventory-client';
import { useLanguage } from './i18n';
import { factoryTime, fixedInput, quantity } from './erp-client';
import { useFloor } from './copy';
import { ChoiceCards, EntrySentence } from './ui';

interface InboundOrder { id: string; reference: string; status: string; supplier_name: string; title: string; specifications: string; quantity_milli: number; unit: string }
interface Receipt { id: string; purchase_order_id: string; lot_id: string; quantity_milli: number; grams: number; batch: string; supplier_lot: string; created_at: number; reversal_id: string | null }
interface InboundState { orders: InboundOrder[]; receipts: Receipt[]; products: Product[] }
export default function IncomingStock({ member, onInventoryChanged }: { member: Member; onInventoryChanged: () => Promise<void> }) {
 const { t } = useLanguage();const [state,setState]=useState<InboundState|null>(null),[error,setError]=useState(''),[open,setOpen]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{try{setState(await api<InboundState>('/erp/inbound'));setError('');}catch(e){setError(errorMessage(e));}},[]);
 useEffect(()=>{void load();},[load]);const saved=async()=>{await onInventoryChanged();await load();setOpen('');setNotice(t('Receipt saved. Stock requires QC approval before production.', 'وصولی محفوظ ہو گئی۔ پروڈکشن سے پہلے کوالٹی کی منظوری درکار ہے۔'));};
 return <section className="live-panel"><div className="yf-head"><div><h2>{t('Incoming stock', 'آنے والا اسٹاک')}</h2><p>{t('Receive against accepted purchase orders, then inspect and label each batch.', 'منظور شدہ خریداری آرڈر کے مطابق مال وصول کریں، پھر ہر بیچ کا معائنہ اور لیبل بنائیں۔')}</p></div><button className="button" onClick={()=>void load()}><RefreshCw size={18}/>{t('Refresh receipts', 'وصولیاں تازہ کریں')}</button></div>
  {error&&<p className="live-error" role="alert">{t(error)}</p>}{notice&&<p className="live-success" role="status">{notice}</p>}{!state&&!error&&<p role="status">{t('Loading incoming orders…','آنے والے آرڈر لوڈ ہو رہے ہیں…')}</p>}
  {state&&!state.orders.length&&<p className="live-muted">{t('Accepted supplier purchase orders appear here.', 'منظور شدہ سپلائر خریداری آرڈر یہاں نظر آئیں گے۔')}</p>}
  <div className="erp-records">{state?.orders.map(o=>{const receipts=state.receipts.filter(r=>r.purchase_order_id===o.id),remaining=o.quantity_milli-receipts.filter(r=>!r.reversal_id).reduce((n,r)=>n+r.quantity_milli,0);return <article className="erp-record" key={o.id}><h3>{o.reference} · {o.supplier_name}</h3><h4>{o.title}</h4><p className="erp-multiline">{o.specifications}</p><p>{t('Remaining to receive:', 'باقی وصولی:')} {quantity(remaining)} {o.unit}</p>
   {open==='receive:'+o.id?<ReceiveForm order={o} remaining={remaining} products={state.products} onSaved={saved} onCancel={()=>setOpen('')}/>:remaining>0&&can(member,'receive')&&<button className="button primary" onClick={()=>setOpen('receive:'+o.id)}><Plus size={18}/>{t('Receive purchase order', 'خریداری آرڈر وصول کریں')}</button>}
   {receipts.map(r=><div className="erp-shipment" key={r.id}><strong>{r.batch} · {quantity(r.quantity_milli)} {o.unit}</strong><span>{factoryTime(r.created_at)}{r.supplier_lot?' · '+r.supplier_lot:''}{r.reversal_id?' · '+t('Reversed','واپس کیا گیا'):''}</span><a className="button" href={'#/inventory/'+r.lot_id}>{t('Open batch, QC and QR label', 'بیچ، کوالٹی اور QR لیبل کھولیں')}</a>{!r.reversal_id&&can(member,'reverse')&&(open==='reverse:'+r.id?<ReverseReceipt receipt={r} onSaved={async()=>{await onInventoryChanged();setOpen('');setNotice(t('Receipt reversed. The original remains in history.','وصولی واپس کر دی گئی۔ اصل اندراج ہسٹری میں موجود ہے۔'));await load();}} onCancel={()=>setOpen('')}/>:<button className="live-text-button" onClick={()=>setOpen('reverse:'+r.id)}>{t('Correct this receipt', 'یہ وصولی درست کریں')}</button>)}</div>)}
  </article>;})}</div>
 </section>;
}
function ReceiveForm({order,remaining,products,onSaved,onCancel}:{order:InboundOrder;remaining:number;products:Product[];onSaved:()=>Promise<void>;onCancel:()=>void}){
 const {t}=useLanguage();const say=useFloor();
 // Nothing is chosen or typed for the worker: the material, the amount and the counts all come from the delivery in front of them.
 const [id]=useState(crypto.randomUUID()),[productId,setProduct]=useState(''),[qty,setQty]=useState(''),[batch,setBatch]=useState(''),[supplierLot,setSupplierLot]=useState(''),[cartons,setCartons]=useState(''),[cones,setCones]=useState(''),[tried,setTried]=useState(false);
 const left=quantity(remaining);const milli=/^\d+(\.\d{1,3})?$/.test(qty.trim())?Math.round(Number(qty)*1000):0;
 const errors:Record<string,string>={};
 if(!productId)errors.product=t('Tap the material that arrived.','جو مٹیریل آیا ہے اسے دبائیں۔');
 if(!batch.trim())errors.batch=t('Type the batch number for this delivery.','اس ڈیلیوری کا بیچ نمبر لکھیں۔');
 if(!milli)errors.qty=say('typeKg');else if(milli>remaining)errors.qty=t(`Only ${left} ${order.unit} of this order is still to come.`,`اس آرڈر کا صرف ${left} ${order.unit} باقی ہے۔`);
 for(const [field,value] of [['cartons',cartons],['cones',cones]] as const){if(!value.trim())errors[field]=say('typeCount',{unit:say(field).toLocaleLowerCase()});else if(!/^\d+$/.test(value.trim()))errors[field]=say('wholeNumber');}
 const show=(field:string)=>tried?errors[field]:undefined;
 const material=products.find(p=>p.id===productId);
 const sentence=t(`${cartons||0} cartons · ${cones||0} cones · ${qty||0} ${order.unit} of ${material?.name||''}, batch ${batch}, received against ${order.reference}.`,`${material?.name||''} (بیچ ${batch}) کا ${cartons||0} کارٹن · ${cones||0} کون · ${qty||0} ${order.unit} آرڈر ${order.reference} کے تحت وصول ہوا۔`);
 const box=(field:'cartons'|'cones',value:string,set:(v:string)=>void)=><div className="yf-qty"><label htmlFor={`po-${field}`}>{say(field)}</label><input id={`po-${field}`} dir="ltr" inputMode="numeric" autoComplete="off" value={value} aria-invalid={!!show(field)} onChange={e=>set(e.target.value.replace(/\D/g,''))}/>{show(field)?<p className="live-field-error">{show(field)}</p>:<p className="yf-qty-help">{say('zeroIfNone')}</p>}</div>;
 return <AsyncForm className="yf-entry" title={t('Receive purchase order','خریداری آرڈر وصول کریں')} detail={order.reference} submit={t('Save receipt and create QC batch','وصولی محفوظ کریں اور کوالٹی بیچ بنائیں')} onCancel={onCancel} note={t('Received stock is recorded as uninspected. QC approval is required before issuing raw material to production.', 'وصول شدہ مال بغیر معائنے کے درج ہوتا ہے۔ خام مال پروڈکشن میں دینے سے پہلے کوالٹی منظوری درکار ہے۔')}
  check={()=>{setTried(true);return !Object.keys(errors).length;}}
  labels={{next:say('next'),reviewTitle:say('checkThis'),reviewHint:say('checkThisHint'),change:say('change'),cancel:say('cancel'),saving:say('saving'),fixAbove:say('fixAbove')}}
  review={<EntrySentence sentence={sentence} numbers={[[say('cartons'),cartons||'0'],[say('cones'),cones||'0'],[order.unit,qty||'0']]} warnings={!Number(cartons)&&!Number(cones)?[say('zeroCounts')]:[]}/>}
  onSubmit={async()=>{await api('/erp/receipts',{id,orderId:order.id,productId,batch:batch.trim(),quantityMilli:fixedInput(qty,3,'Quantity'),cartons:Number(cartons),cones:Number(cones),supplierLot});await onSaved();}}>
  <p className="yf-entry-have">{t('Order','آرڈر')}: <strong>{order.title}</strong> · {t('still to come','ابھی باقی')}: <span dir="ltr">{left} {order.unit}</span></p>
  {!products.length&&<p className="live-warning">{t('Add the material in Stock before receiving it.', 'وصولی سے پہلے اسٹاک میں میٹیریل شامل کریں۔')}</p>}
  <ChoiceCards label={t('Which material arrived?','کون سا مٹیریل آیا؟')} value={productId} onChange={setProduct} error={show('product')} options={products.map(p=>({id:p.id,label:p.name,detail:p.sku}))}/>
  <Field>{t('Internal receipt batch','اندرونی وصولی بیچ')}<input value={batch} onChange={e=>setBatch(e.target.value)} maxLength={100} aria-invalid={!!show('batch')}/></Field>{show('batch')&&<p className="live-field-error">{show('batch')}</p>}
  <Field>{t('Supplier lot reference (optional)','سپلائر لاٹ حوالہ (اختیاری)')}<input value={supplierLot} onChange={e=>setSupplierLot(e.target.value)} maxLength={100}/></Field>
  <fieldset className="yf-qty-grid"><legend>{say('howMuch')}</legend>{box('cartons',cartons,setCartons)}{box('cones',cones,setCones)}
   <div className="yf-qty is-big"><label htmlFor="po-qty">{t(`Received quantity (${order.unit})`,`وصول شدہ مقدار (${order.unit})`)}</label><input id="po-qty" dir="ltr" inputMode="decimal" autoComplete="off" value={qty} aria-invalid={!!show('qty')} onChange={e=>setQty(e.target.value.replace(/[^\d.]/g,''))}/>{show('qty')&&<p className="live-field-error">{show('qty')}</p>}</div></fieldset>
 </AsyncForm>;
}
function ReverseReceipt({receipt,onSaved,onCancel}:{receipt:Receipt;onSaved:()=>Promise<void>;onCancel:()=>void}){
 const {t}=useLanguage();const [id]=useState(crypto.randomUUID()),[reason,setReason]=useState('');
 return <AsyncForm title={t('Reverse purchase receipt','خریداری وصولی واپس کریں')} detail={receipt.batch} submit={t('Reverse receipt','وصولی واپس کریں')} onCancel={onCancel} note={t('A receipt cannot be reversed after its stock has been used. The original record is kept.', 'اسٹاک استعمال ہونے کے بعد وصولی واپس نہیں کی جا سکتی۔ اصل اندراج محفوظ رہتا ہے۔')} onSubmit={async()=>{await api('/erp/receipts/reverse',{id,receiptId:receipt.id,reason});await onSaved();}}><Field>{t('Correction reason','درستگی کی وجہ')}<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={1000} required/></Field></AsyncForm>;
}
