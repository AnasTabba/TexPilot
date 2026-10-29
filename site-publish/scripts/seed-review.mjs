/** Explicit local-only review data. Never run against a production workspace. */
if(process.env.YARNFLOW_REVIEW_SEED!=='1')throw new Error('Set YARNFLOW_REVIEW_SEED=1 to populate the isolated review server.');
const base='http://127.0.0.1:8788';
async function api(path,data){const response=await fetch(base+'/api'+path,{method:data?'POST':'GET',headers:{Origin:base,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});const body=await response.json();if(!response.ok)throw new Error(body.error);return body;}
let state=await api('/workspace');
if(state.member){if(state.workspace.name!=='Yarnflow review · Crescent Mill')throw new Error('Refusing to seed an existing non-review workspace.');console.log('Review workspace already exists; left unchanged.');process.exit(0);}
await api('/workspaces',{name:'Yarnflow review · Crescent Mill'});
const items=[['Compact cotton Ne 30/1','CTN-30',8250000,'raw','approved'],['PC blend Ne 26/1','PC-26',5950000,'raw','approved'],['Carded cotton Ne 20/1','CTN-20',4100000,'wip','uninspected'],['Indigo denim 3/1','DNM-31',3350000,'wip','hold'],['Polyester Ne 40/1','PES-40',2000000,'finished','approved'],['Viscose Ne 30/1','VIS-30',1200000,'finished','uninspected']];
for(const [index,item] of items.entries()){
 const [name,sku,grams,stage,status]=item;
 const p=await api('/products',{name,sku,barcode:''});const lot=await api('/lots',{productId:p.id,batch:'LOT-'+(1024-index),supplier:index%2?'Indus Textile Mills':'Crescent Cotton Co.'});
 await api('/movements',{id:crypto.randomUUID(),lotId:lot.id,action:'receive',stage:'raw',grams,cartons:20,cones:480,note:'Illustrative receipt in isolated review database'});
 if(stage!=='raw')await api('/movements',{id:crypto.randomUUID(),lotId:lot.id,action:'transfer',stage:'raw',toStage:stage,grams,cartons:20,cones:480,note:'Illustrative production stage transfer'});
 if(status!=='uninspected')await api('/quality',{lotId:lot.id,status,note:status==='hold'?'Review dye consistency before dispatch.':'Physical sample checked for this isolated review.'});
}
state=await api('/workspace');console.log(`Review workspace ready: ${state.lots.length} batches, ${state.balances.reduce((s,b)=>s+b.grams,0)/1000} kg. No production data was changed.`);
