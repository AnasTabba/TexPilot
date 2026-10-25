import type { Product, StockBalance, StockLot, StockMovement, StockStage, WorkspaceState } from './inventory-client';

type Saved = Omit<WorkspaceState, 'balances' | 'serverTime' | 'backend'>;
const KEY = 'yf-local-inventory-v1';
const stages: StockStage[] = ['raw', 'wip', 'finished', 'cops'];
const uid = () => crypto.randomUUID();
const fail = (message: string): never => { throw new Error(message); };
const positive = (value: unknown, label: string, allowZero = false) => {
  if (!Number.isSafeInteger(value) || Number(value) < (allowZero ? 0 : 1)) fail(`${label} must be a valid whole number.`);
  return Number(value);
};
const text = (value: unknown, label: string, min = 1) => {
  if (typeof value !== 'string' || value.trim().length < min) fail(`Enter ${label}.`);
  return String(value).trim();
};
function sample(): Saved {
  const now = Date.now();
  const products: Product[] = [
    {id:uid(),sku:'CTN-30',name:'Combed cotton Ne 30/1',barcode:null},
    {id:uid(),sku:'PC-26',name:'Poly cotton Ne 26/1',barcode:null},
    {id:uid(),sku:'PES-40',name:'Polyester Ne 40/1',barcode:null},
    {id:uid(),sku:'VIS-30',name:'Viscose Ne 30/1',barcode:null},
  ];
  const lots: StockLot[] = products.map((product,index) => ({id:uid(),product_id:product!.id,batch:`DEMO-${1024-index}`,supplier:index%2?'Indus Textile Mills':'Crescent Cotton Co.',quality:index===2?'uninspected':index===3?'hold':'approved',created_at:now-(index+2)*86400000}));
  const movement = (lot: StockLot, action: string, from_stage: StockStage | null, to_stage: StockStage | null, grams: number, days: number): StockMovement => ({id:uid(),lot_id:lot!.id,action,from_stage,to_stage,grams,cartons:Math.round(grams/250000),cones:Math.round(grams/25000),note:'Sample inventory for the MVP preview',actor_name:'MVP sample',created_at:now-days*86400000,reverses:null});
  const movements = [movement(lots[0],'receive',null,'raw',8250000,6),movement(lots[1],'receive',null,'raw',5950000,5),movement(lots[2],'receive',null,'raw',4100000,4),movement(lots[3],'receive',null,'raw',3350000,3),movement(lots[1],'transfer','raw','wip',2100000,2),movement(lots[0],'transfer','raw','finished',1500000,1)].reverse();
  return {workspace:{id:uid(),name:'Yarnflow MVP · sample inventory'},member:{user_id:'local',name:'Factory team',role:'owner'},products,lots,movements,members:[{name:'Factory team',role:'owner',joined_at:now}],inspections:[],photos:[],qualityEvents:[]};
}
function read(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { const initial=sample(); localStorage.setItem(KEY,JSON.stringify(initial)); return initial; }
    const data=JSON.parse(raw) as Saved;
    if (!Array.isArray(data.products)||!Array.isArray(data.lots)||!Array.isArray(data.movements)) throw Error('invalid');
    return data;
  } catch { throw new Error('Inventory on this device could not be opened. Restore a backup before changing browser data.'); }
}
function write(data: Saved) { try { localStorage.setItem(KEY,JSON.stringify(data)); } catch { throw new Error('This device could not save the entry. Free browser storage and retry.'); } }
function balances(data: Saved): StockBalance[] {
  const map = new Map<string,StockBalance>();
  for (const movement of data.movements.slice().reverse()) {
    for (const [stage,sign] of [[movement.from_stage,-1],[movement.to_stage,1]] as const) {
      if (!stage) continue;
      const key=`${movement.lot_id}:${stage}`;
      const b=map.get(key)||{lot_id:movement.lot_id,stage,grams:0,cartons:0,cones:0};
      b.grams+=sign*movement.grams; b.cartons+=sign*movement.cartons; b.cones+=sign*movement.cones; map.set(key,b);
    }
  }
  return [...map.values()];
}
function ensureBalances(data: Saved) {
  if (balances(data).some(b=>b.grams<0||b.cartons<0||b.cones<0)) fail('Not enough stock in this stage. Check the amount and retry.');
}
function snapshot(data: Saved): WorkspaceState { return {...data,balances:balances(data),serverTime:Date.now(),backend:'This browser · offline inventory'}; }
function byNewest<T extends {created_at:number}>(items:T[]) { return items.slice().sort((a,b)=>b.created_at-a.created_at); }
export async function localInventoryRequest<T>(path: string, body?: unknown): Promise<T> {
  const data=read(); const input=(body||{}) as Record<string,unknown>;
  const url=new URL(path,'https://local.invalid'); const route=url.pathname;
  let result: unknown;
  if (route==='/workspace') result=snapshot(data);
  else if (route==='/products' && body) {
    const sku=text(input.sku,'SKU'); const name=text(input.name,'material name',2); const barcode=typeof input.barcode==='string'&&input.barcode.trim()?input.barcode.trim():null;
    if (data.products.some(p=>p.sku.toLowerCase()===sku.toLowerCase()||(barcode&&p.barcode===barcode))) fail('This SKU or barcode is already in the catalogue.');
    const product={id:uid(),sku,name,barcode}; data.products.push(product); write(data); result=product;
  } else if (route==='/lots' && body) {
    const product=data.products.find(p=>p.id===input.productId); if(!product) fail('Choose a material first.');
    const batch=text(input.batch,'batch number'); if(data.lots.some(l=>l.product_id===product!.id&&l.batch.toLowerCase()===batch.toLowerCase())) fail('This material already has that batch number.');
    const lot:StockLot={id:uid(),product_id:product!.id,batch,supplier:typeof input.supplier==='string'?input.supplier.trim():'',quality:'uninspected',created_at:Date.now()};data.lots.unshift(lot);write(data);result=lot;
  } else if (route==='/quality' && body) {
    const lot=data.lots.find(l=>l.id===input.lotId);if(!lot) fail('Batch not found.');
    if(!['approved','hold','uninspected'].includes(String(input.status))) fail('Choose a quality status.');
    const note=text(input.note,'inspection reason',3);lot!.quality=input.status as StockLot['quality'];
    data.qualityEvents.unshift({id:uid(),lot_id:lot!.id,status:lot!.quality,note,actor_name:data.member.name,created_at:Date.now()});write(data);result={saved:true};
  } else if (route==='/movements' && body) {
    const existing=data.movements.find(m=>m.id===input.id);if(existing)return existing as T;
    const lot=data.lots.find(l=>l.id===input.lotId);if(!lot) fail('Batch not found.');
    const action=String(input.action);if(!['receive','transfer','dispatch','waste'].includes(action))fail('Choose a valid stock movement.');
    const stage=input.stage as StockStage;if(!stages.includes(stage))fail('Choose a valid stock stage.');
    const toStage=input.toStage as StockStage;if(action==='transfer'&&(!stages.includes(toStage)||toStage===stage))fail('Choose a different destination stage.');
    if(action==='dispatch'&&lot!.quality!=='approved')fail('This batch needs QC approval before dispatch.');
    const movement:StockMovement={id:String(input.id||uid()),lot_id:lot!.id,action,from_stage:action==='receive'?null:stage,to_stage:action==='receive'?stage:action==='transfer'?toStage:null,grams:positive(input.grams,'Weight'),cartons:positive(input.cartons??0,'Cartons',true),cones:positive(input.cones??0,'Cones',true),note:typeof input.note==='string'?input.note.trim():'',actor_name:data.member.name,created_at:Date.now(),reverses:null};
    data.movements.unshift(movement);ensureBalances(data);write(data);result=movement;
  } else if (route==='/reversals' && body) {
    const original=data.movements.find(m=>m.id===input.movementId);if(!original||original!.action==='reverse')fail('Movement not found.');
    if(data.movements.some(m=>m.reverses===original!.id))fail('This movement was already reversed.');
    const note=text(input.note,'reversal reason',3);
    const movement:StockMovement={...original!,id:String(input.id||uid()),action:'reverse',from_stage:original!.to_stage,to_stage:original!.from_stage,note,actor_name:data.member.name,created_at:Date.now(),reverses:original!.id};data.movements.unshift(movement);ensureBalances(data);write(data);result=movement;
  } else if (route==='/inspections' && body) {
    const lot=data.lots.find(l=>l.id===input.lotId);if(!lot)fail('Batch not found.');
    const existing=data.inspections.find(i=>i.id===input.id);if(existing)return existing as T;
    const item={id:String(input.id||uid()),lot_id:lot!.id,label_text:typeof input.labelText==='string'?input.labelText:'',note:text(input.note,'inspection note',3),source:input.result?'client-texpilot':'manual',result_json:input.result?JSON.stringify(input.result):null,actor_name:data.member.name,created_at:Date.now()};data.inspections.unshift(item);write(data);result={id:item.id,qualityChanged:false};
  } else if (route.startsWith('/lots/')&&route.endsWith('/evidence')) {
    const lotId=route.split('/')[2];result={inspections:byNewest(data.inspections.filter(i=>i.lot_id===lotId)),qualityEvents:byNewest(data.qualityEvents.filter(i=>i.lot_id===lotId)),photos:byNewest(data.photos.filter(p=>p.lot_id===lotId)),nextOffset:null};
  } else if (route==='/lookup') {
    const code=url.searchParams.get('code')||'';const normalized=code.startsWith('YF:')?code.slice(3):code;
    const matches=data.lots.filter(l=>l.id===normalized||l.batch===code||data.products.some(p=>p.id===l.product_id&&(p.sku===code||p.barcode===code))).map(l=>({id:l.id,batch:l.batch,name:data.products.find(p=>p.id===l.product_id)?.name||'Material'}));
    if(!matches.length)fail('No matching batch. Check the code or add the batch first.');result=matches.length===1?{lotId:matches[0].id}:{lots:matches};
  } else if (route==='/movements') result={movements:byNewest(data.movements).slice(Number(url.searchParams.get('offset'))||0,(Number(url.searchParams.get('offset'))||0)+100)};
  else if (route==='/export') result={...snapshot(data),nextOffset:null,exportedAt:new Date().toISOString()};
  else if (route==='/integrations/inventree') result={connected:false,reason:'Inventory is stored in this browser. No external inventory connection is configured.'};
  else if (route==='/invites') fail('Invites need a shared backend. This MVP stores inventory on one device.');
  else fail('This action is not available in the offline MVP.');
  return result as T;
}
export function resetLocalInventory() { const empty=sample(); empty.workspace.name='Yarnflow MVP'; empty.products=[]; empty.lots=[]; empty.movements=[]; write(empty); }
export function restoreLocalInventory(value:unknown) {
  const data=value as Partial<Saved>;
  if(!data||!Array.isArray(data.products)||!Array.isArray(data.lots)||!Array.isArray(data.movements)||!Array.isArray(data.inspections)||!Array.isArray(data.qualityEvents))fail('This is not a Yarnflow inventory backup.');
  const restored:Saved={workspace:data.workspace||{id:uid(),name:'Yarnflow MVP'},member:{user_id:'local',name:'Factory team',role:'owner'},products:data.products!,lots:data.lots!,movements:data.movements!,members:[{name:'Factory team',role:'owner',joined_at:Date.now()}],inspections:data.inspections!,qualityEvents:data.qualityEvents!,photos:Array.isArray(data.photos)?data.photos:[]};ensureBalances(restored);write(restored);
}
