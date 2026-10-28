import { launchBrowser } from './browser.mjs';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
const before=process.argv.includes('--before');
const linksOnly=process.argv.includes('--links');
const dialogsOnly=process.argv.includes('--dialogs');
const datesOnly=process.argv.includes('--dates');
const base=process.env.CALM_BASE_URL || 'http://127.0.0.1:8792';
const root=`docs/progress/calm/${before?'before':'after'}`;
fs.mkdirSync(root,{recursive:true});
const routes=['overview','production','inventory','orders','dispatch','register','more','scanner','reports','settings','help','search','close','masters','users','import','home','components','sync','login'];
const previous=(linksOnly||dialogsOnly||datesOnly)?JSON.parse(fs.readFileSync(`${root}/audit.json`,'utf8')):null;
const results=previous?previous.results.filter(r=>!(linksOnly?['live-welcome','live-settings','live-scanner-spec']:datesOnly?['register-lot-detail','register-report-detail']:['register-receipt-saved','register-reopen-dialog']).includes(r.name)):[], errors=previous?.errors||[];
const run=Date.now();
const browser=await launchBrowser();
async function capture(page,name,config,{dialog=false}={}) {
 await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(()=>{if(document.activeElement?.matches('.skip-link'))document.activeElement.blur();window.scrollTo({top:0,left:0,behavior:'instant'});});
 const layout=await page.evaluate(()=> {
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
  const texts=[...document.querySelectorAll('body *')].filter(e=>visible(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));
  const smallText=texts.filter(e=>parseFloat(getComputedStyle(e).fontSize)<14).map(e=>({text:e.textContent.slice(0,70),size:getComputedStyle(e).fontSize,selector:e.className}));
  const rgba=value=>{const n=value.match(/[\d.]+/g)?.map(Number);return n?.length>=3?[n[0],n[1],n[2],n[3]??1]:[0,0,0,0]};
  const blend=(a,b)=>a.slice(0,3).map((x,i)=>x*a[3]+b[i]*(1-a[3]));
  const luminance=rgb=>rgb.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
  const disabledControls=[...document.querySelectorAll('button:disabled,input:disabled,select:disabled,button.disabled,[aria-disabled=true]')].filter(visible).map(e=>{
   const st=getComputedStyle(e);let bg=[255,255,255];const ancestors=[];for(let p=e;p;p=p.parentElement)ancestors.unshift(p);for(const p of ancestors)bg=blend(rgba(getComputedStyle(p).backgroundColor),bg);
   const ink=blend(rgba(st.color),bg);const l=[luminance(bg),luminance(ink)].sort((a,b)=>b-a);
   return {label:e.textContent.trim()||e.name,opacity:st.opacity,color:st.color,background:st.backgroundColor,contrast:Math.round((l[0]+.05)/(l[1]+.05)*100)/100};});
  const controls=[...document.querySelectorAll('button,a[href],input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea,summary')].filter(visible).map(e=>({label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,50)||e.name||e.placeholder,width:Math.round(e.getBoundingClientRect().width),height:Math.round(e.getBoundingClientRect().height),tag:e.tagName})).filter(e=>e.width<48||e.height<48);
  const blurs=[...document.querySelectorAll('body *')].filter(e=>visible(e)&&getComputedStyle(e).backdropFilter!=='none').map(e=>({class:e.className,filter:getComputedStyle(e).backdropFilter,bg:getComputedStyle(e).backgroundColor}));
  const purple=[];const gradients=[];const wrongType=[];
  const allowedGlass=e=>e.matches('.live-sidebar,.live-topbar,.live-bottom-nav,.live-segments,.sidebar,.topbar,.bottom-nav,.bottom-tabs,.modal,.modal-panel,.modal-dialog,.segments,.segmented-control,.segmented,.tab-switcher,[role=dialog]');
  for(const e of document.querySelectorAll('body *'))if(visible(e)){
   const st=getComputedStyle(e);
   if(st.backgroundImage.includes('gradient')&&!allowedGlass(e))gradients.push(e.className);
   for(const property of ['color','backgroundColor','borderTopColor','fill','stroke']){const m=st[property]?.match(/^rgba?\((\d+), (\d+), (\d+)/);if(!m)continue;const rgb=m.slice(1).map(Number);const mx=Math.max(...rgb),mn=Math.min(...rgb),delta=mx-mn;if(delta<25)continue;let hue=(mx===rgb[0]?(rgb[1]-rgb[2])/delta:mx===rgb[1]?(rgb[2]-rgb[0])/delta+2:(rgb[0]-rgb[1])/delta+4)*60;if(hue<0)hue+=360;if(hue>=245&&hue<=310)purple.push({class:e.className,property,color:st[property]});}
  }
  for(const e of texts){const st=getComputedStyle(e);if(![14,16,18,20,24,32,40].includes(parseFloat(st.fontSize))||![400,500,600].includes(parseInt(st.fontWeight)))wrongType.push({text:e.textContent.slice(0,40),size:st.fontSize,weight:st.fontWeight,class:e.className});}
  return {overflow:document.documentElement.scrollWidth>innerWidth,smallText,smallControls:controls,disabledControls,blurs,font:getComputedStyle(document.body).fontFamily,purple,gradients,wrongType,reducedTransparency:matchMedia('(prefers-reduced-transparency: reduce)').matches,nestedGlass:[...document.querySelectorAll('body *')].filter(e=>visible(e)&&getComputedStyle(e).backdropFilter!=='none'&&(()=>{for(let p=e.parentElement;p;p=p.parentElement)if(getComputedStyle(p).backdropFilter!=='none')return true;return false;})()).map(e=>e.className)};
 });
 const file=`${name}-${config.name}.png`;
 await page.screenshot({path:`${root}/${file}`,fullPage:!dialog});
 const audit=before?{violations:[]}:await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 const result={...config,variant:config.name,name,file,...layout,violations:audit.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))};
 const prior=results.findIndex(r=>r.file===file);if(prior>=0)results.splice(prior,1);results.push(result);fs.writeFileSync(`${root}/audit.json`,JSON.stringify({results,errors},null,2));
 console.log(`${file}: ${result.violations.length} axe, ${layout.smallText.length} small text, ${layout.smallControls.length} small controls, overflow ${layout.overflow}`);
}
async function legacyForms(page,config) {
 const visit=async route=>{await page.goto(`${base}/?practice=1#/${route}`);await page.reload();await page.locator('h1').waitFor();};
 const close=async()=>{const d=page.getByRole('dialog');if(await d.count())await d.getByRole('button',{name:'Close',exact:true}).click();};
 const attempt=async(name,fn)=>{try{await fn();}catch(e){errors.push({config:config.name,name,error:e.message});console.log(`ERROR ${name}: ${e.message.slice(0,140)}`);await close().catch(()=>{});}};
 for(const [kind,route,action] of [['production','production','Record production'],['receipt','inventory','Receive yarn'],['dispatch','dispatch','Record dispatch'],['issue','home','Issue to machine']]) {
  await attempt(`register-${kind}-form`,async()=>{
   await visit(route);await page.getByRole('button',{name:action,exact:true}).click();const d=page.getByRole('dialog');await capture(page,`register-${kind}-step1`,config,{dialog:true});
   await d.getByRole('button',{name:'Continue',exact:true}).click();await capture(page,`register-${kind}-step2`,config,{dialog:true});
   if(!before){const next=d.getByRole('button',{name:'Continue',exact:true});if(await next.isEnabled())await next.click();await capture(page,`register-${kind}-validation`,config,{dialog:true});}
   await d.getByRole('textbox',{name:'Cartons',exact:true}).fill('1');await d.getByRole('textbox',{name:'Net weight in kilograms'}).fill('20.125');
   await d.getByRole('button',{name:'Continue',exact:true}).click();await d.getByRole('heading',{name:'Check before saving',exact:true}).waitFor();await capture(page,`register-${kind}-review`,config,{dialog:true});await close();
  });
 }
 await attempt('register-order-form',async()=>{await visit('orders');await page.getByRole('button',{name:'Record order',exact:true}).click();const d=page.getByRole('dialog');await capture(page,'register-order-form',config,{dialog:true});await d.getByRole('textbox',{name:'Required weight (kg)'}).fill('1200');const due=d.getByLabel('Required by',{exact:true});await due.fill(await due.getAttribute('min'));await d.getByRole('button',{name:'Review order',exact:true}).click();await d.getByRole('heading',{name:'Check before saving',exact:true}).waitFor();await capture(page,'register-order-review',config,{dialog:true});await close();});
 await attempt('register-entry-detail',async()=>{await visit('production');await page.getByRole('button',{name:'View entry',exact:true}).first().click();await capture(page,'register-entry-detail',config,{dialog:true});await page.getByRole('dialog').getByRole('button',{name:'Reverse entry',exact:true}).click();await capture(page,'register-entry-reversal',config,{dialog:true});await close();});
 await attempt('register-lot-detail',async()=>{await visit('overview');await page.getByRole('button',{name:'Review lot',exact:true}).click();await capture(page,'register-lot-detail',config,{dialog:true});await close();});
 await attempt('register-order-detail',async()=>{await visit('overview');await page.getByRole('button',{name:'View order',exact:true}).first().click();await capture(page,'register-order-detail',config,{dialog:true});await close();});
 await attempt('register-report-detail',async()=>{await visit('reports');await page.getByRole('button',{name:/Daily summary/}).click();await capture(page,'register-report-detail',config,{dialog:true});await close();});
 await attempt('register-settings-tabs',async()=>{await visit('settings');for(const name of ['Appearance','Data & masters','People & devices']){await page.getByRole('button',{name,exact:true}).click();await capture(page,`register-settings-${name.replaceAll(/[^a-zA-Z]/g,'').toLowerCase()}`,config);}});
}
async function populate(context) {
 const post=async(path,data)=>{const response=await context.request.post(base+'/api'+path,{data,headers:{Origin:base}});if(!response.ok())throw new Error(`${path}: ${response.status()} ${await response.text()}`);return response.json();};
 const material=await post('/products',{sku:'COT-30',name:'Cotton combed 30/1',barcode:'8901234567890'});
 const lot=await post('/lots',{productId:material.id,batch:'L-1221',supplier:'Crescent Textiles'});
 const held=await post('/lots',{productId:material.id,batch:'L-1216',supplier:'Crescent Textiles'});
 await post('/movements',{id:crypto.randomUUID(),lotId:lot.id,action:'receive',stage:'raw',grams:2847000,cartons:133,cones:1596,note:'Received against delivery note DN-246.'});
 await post('/movements',{id:crypto.randomUUID(),lotId:held.id,action:'receive',stage:'raw',grams:850000,cartons:40,cones:480,note:'Awaiting physical QC checks.'});
 await post('/quality',{lotId:lot.id,status:'approved',note:'Physical check passed. Label and delivery note match.'});
 await post('/quality',{lotId:held.id,status:'hold',note:'Dye shade needs supervisor review.'});
 await post('/inspections',{id:crypto.randomUUID(),lotId:lot.id,labelText:'100% cotton',note:'Surface and care label checked at receipt.',result:null});
 return lot.id;
}
async function liveForms(page,config,lotId) {
 const visit=async route=>{await page.goto(`${base}/#/${route}`);await page.reload();await page.locator('.live-sidebar').waitFor({state:'attached'});};
 const attempt=async(name,fn)=>{try{await fn();}catch(e){errors.push({config:config.name,name,error:e.message});console.log(`ERROR ${name}: ${e.message.slice(0,140)}`);}};
 for(const route of ['overview','inventory','activity']){await visit(route);await capture(page,`live-${route}-populated`,config);}
 await attempt('live-material-form',async()=>{await visit('inventory');await page.getByRole('button',{name:'Add material',exact:true}).click();await capture(page,'live-material-form',config);if(!before){await page.getByRole('button',{name:'Review entry',exact:true}).click();await capture(page,'live-material-validation',config);await page.getByRole('textbox',{name:/Material name/}).fill('Modal 40/1');await page.getByRole('textbox',{name:/SKU/}).fill('MOD-40');await page.getByRole('button',{name:'Review entry',exact:true}).click();await capture(page,'live-material-review',config);}});
 await attempt('live-batch-form',async()=>{await visit('inventory');await page.getByRole('button',{name:before?'New batch':'Create batch',exact:true}).click();await capture(page,'live-batch-form',config);if(!before){await page.getByLabel('Batch / dye lot',{exact:true}).fill('L-1222');await page.getByRole('button',{name:'Review entry',exact:true}).click();await capture(page,'live-batch-review',config);}});
 await visit(`inventory/${lotId}`);await page.getByRole('heading',{name:'Cotton combed 30/1',exact:true}).waitFor();await capture(page,'live-lot-detail',config);
 for(const [key,action] of [['receive','Receive stock'],['transfer','Move stock'],['dispatch','Dispatch'],['waste','Record waste'],['inspection','Record inspection'],['quality','Review quality']]) {
  await attempt(`live-${key}-form`,async()=>{await visit(`inventory/${lotId}`);await page.getByRole('button',{name:action,exact:true}).click();await capture(page,`live-${key}-form`,config);if(!before){if(['receive','transfer','dispatch','waste'].includes(key)){await page.getByLabel('Weight (kg)',{exact:true}).fill('20.125');await page.getByLabel('Cartons',{exact:true}).fill('1');await page.getByLabel('Cones',{exact:true}).fill('24');}if(key==='quality')await page.getByLabel('Inspection reason',{exact:true}).fill('Checked physical stock and care label.');if(key==='inspection')await page.getByLabel('Notes',{exact:true}).fill('Checked care label and surface.');await page.getByRole('button',{name:'Review entry',exact:true}).click();await capture(page,`live-${key}-review`,config);}});
 }
 await attempt('live-reversal-form',async()=>{await visit('activity');await page.getByRole('button',{name:'Reverse entry',exact:true}).first().click();await capture(page,'live-reversal-form',config);if(!before){await page.getByLabel('Reason',{exact:true}).fill('Correcting the received register quantity.');await page.getByRole('button',{name:'Review entry',exact:true}).click();await page.getByRole('heading',{name:'Review before saving',exact:true}).waitFor();await capture(page,'live-reversal-review',config);}});
 await visit('scanner');await page.getByRole('button',{name:'Fabric inspection',exact:true}).click();await capture(page,'live-scanner-fabric',config);
 await page.getByRole('button',{name:'Yarn spec',exact:true}).click();await capture(page,'live-scanner-spec',config);if(!before){await visit('inventory');await page.context().setOffline(true);await capture(page,'live-offline',config);await page.context().setOffline(false);}
}

async function originalHeaderChecks(page,config){
 const close=()=>page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
 await page.goto(base+'/?practice=1#/orders');await page.reload();await page.getByRole('button',{name:'Record order',exact:true}).click();let d=page.getByRole('dialog');await d.getByRole('textbox',{name:'Required weight (kg)'}).fill('1200');const date=d.getByLabel('Required by',{exact:true});await date.fill(await date.getAttribute('min'));await d.getByRole('button',{name:'Review order',exact:true}).click();await d.getByRole('heading',{name:'Check before saving',exact:true}).waitFor();await capture(page,'register-order-review',config,{dialog:true});await close();
 await page.goto(base+'/?practice=1#/production');await page.reload();await page.getByRole('button',{name:'Record production',exact:true}).click();d=page.getByRole('dialog');await d.getByRole('button',{name:'Continue',exact:true}).click();await d.getByRole('textbox',{name:'Cartons',exact:true}).fill('1');await d.getByRole('textbox',{name:'Net weight in kilograms'}).fill('20.125');await d.getByRole('button',{name:'Continue',exact:true}).click();await d.getByRole('heading',{name:'Check before saving',exact:true}).waitFor();await capture(page,'register-production-review',config,{dialog:true});await close();
 await page.goto(base+'/?practice=1#/overview');await page.reload();await page.getByRole('button',{name:'Review lot',exact:true}).click();await capture(page,'register-lot-detail',config,{dialog:true});await close();
}

async function completedDialogs(page,config) {
 await page.goto(base+'/?practice=1#/inventory');await page.reload();await page.getByRole('button',{name:'Receive yarn',exact:true}).click();let d=page.getByRole('dialog');await d.getByRole('button',{name:'Continue',exact:true}).click();await d.getByRole('textbox',{name:'Cartons',exact:true}).fill('1');await d.getByRole('textbox',{name:'Net weight in kilograms'}).fill('20.125');await d.getByRole('button',{name:'Continue',exact:true}).click();await d.getByRole('heading',{name:'Check before saving',exact:true}).waitFor();await d.getByRole('button',{name:'Save entry',exact:true}).click();await d.getByRole('button',{name:'Undo',exact:true}).waitFor();await capture(page,'register-receipt-saved',config,{dialog:true});await d.getByRole('button',{name:'Undo',exact:true}).click();await d.waitFor({state:'hidden'});
 await page.goto(base+'/?practice=1#/close');await page.reload();for(const check of await page.getByRole('checkbox').all())await check.check();await page.getByRole('button',{name:'Review & close day',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Approve & close',exact:true}).click();await page.getByRole('button',{name:'Reopen with a reason',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Reopen day',exact:true}).waitFor();await capture(page,'register-reopen-dialog',config,{dialog:true});await page.getByRole('dialog').getByRole('textbox',{name:'Reason',exact:true}).fill('Continue isolated QA after checking the closed day.');await page.getByRole('dialog').getByRole('button',{name:'Reopen day',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
}

async function representativeStates(browser) {
 for(const width of [1440,390]){
  const config={name:`${width}-states`,width};
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',serviceWorkers:'block',extraHTTPHeaders:{'x-yarnflow-test-user':`calm-state-${run}-${width}`}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push({config:config.name,error:e.message}));
  for(const [name,button] of [['ready','Ready'],['loading','Loading'],['empty','Empty'],['error','Error'],['permission-denied','Permission denied']]){
   await page.goto(base+'/?practice=1#/components');await page.reload();await page.getByRole('button',{name:button,exact:true}).click();
   if(name==='empty'){await page.goto(base+'/?practice=1#/production');await page.getByRole('heading',{level:1,name:/production/i}).waitFor();}
   if(name==='loading')await page.getByText('Loading your workspace…',{exact:true}).waitFor();
   if(name==='error')await page.getByRole('heading',{name:/load these entries/}).waitFor();
   if(name==='permission-denied')await page.getByRole('heading',{name:/manager access/}).waitFor();
   await capture(page,`register-state-${name}`,config);
  }
  await page.goto(base+'/?practice=1#/close');await page.reload();for(const check of await page.getByRole('checkbox').all())await check.check();await page.getByRole('button',{name:'Review & close day',exact:true}).click();await capture(page,'register-close-confirmation',config,{dialog:true});await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.goto(base+'/?practice=1#/inventory');await page.reload();await page.getByRole('button',{name:'Toggle matrix view',exact:true}).click();await capture(page,'register-stock-matrix',config);
  await context.close();
  const pendingContext=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',serviceWorkers:'block'});
  const pendingPage=await pendingContext.newPage();let release;const paused=new Promise(resolve=>{release=resolve;});
  // Pause the actual request to observe loading, then fail transport offline. No response data is fabricated.
  await pendingContext.route('**/api/workspace',async route=>{await paused;await route.continue().catch(()=>{});});
  await pendingPage.goto(base+'/');await pendingPage.getByRole('heading',{name:'Opening your workspace…',exact:true}).waitFor();await capture(pendingPage,'live-state-loading',config);
  await pendingContext.setOffline(true);release();await pendingPage.getByRole('heading',{name:'Your workspace is unavailable',exact:true}).waitFor();await capture(pendingPage,'live-state-connection-error',config);await pendingContext.close();
 }
}

const configs=before?[{name:'1440',width:1440}]:[{name:'1440',width:1440},{name:'1024',width:1024},{name:'390',width:390},{name:'390-solid',width:390,solid:true},{name:'1440-dark',width:1440,theme:'dark'},{name:'390-urdu',width:390,ur:true}];
for(const config of configs){
 if(dialogsOnly&&(config.ur||config.theme))continue;
 const context=await browser.newContext({viewport:{width:config.width,height:1000},reducedMotion:'reduce',serviceWorkers:'block',extraHTTPHeaders:{'x-yarnflow-test-user':`calm-${run}-${config.name}`}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push({config:config.name,error:e.message}));
 if(config.solid) {const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'},{name:'prefers-reduced-motion',value:'reduce'}]});}
 await page.goto(base+'/?practice=1');
 await page.evaluate(c=>{localStorage.setItem('yf-language',JSON.stringify(!!c.ur));localStorage.setItem('yf-theme',JSON.stringify(c.theme||'light'));},config);
 if(datesOnly){
  await page.goto(base+'/?practice=1#/overview');await page.reload();await page.getByRole('button',{name:config.ur?'لاٹ کا جائزہ':'Review lot',exact:true}).click();let d=page.getByRole('dialog');if(/\b20\d{2}-\d{2}-\d{2}\b/.test(await d.innerText()))throw new Error('ISO date remains in lot detail');await capture(page,'register-lot-detail',config,{dialog:true});
  await page.goto(base+'/?practice=1#/reports');await page.reload();await page.getByRole('button',{name:config.ur?/روزانہ خلاصہ/:/Daily summary/}).click();d=page.getByRole('dialog');if(/\b20\d{2}-\d{2}-\d{2}\b/.test(await d.innerText()))throw new Error('ISO date remains in report detail');await capture(page,'register-report-detail',config,{dialog:true});await context.close();continue;
 }
 if(dialogsOnly){await completedDialogs(page,config);if(config.width===390&&!config.solid)await originalHeaderChecks(page,config);await context.close();continue;}
 if(linksOnly){
  await page.goto(base+'/');await page.getByLabel('Workspace name',{exact:true}).waitFor();await capture(page,'live-welcome',config);
  await page.getByLabel('Workspace name',{exact:true}).fill('QA Factory');await page.getByRole('button',{name:'Create workspace',exact:true}).last().click();await page.locator('.live-app').waitFor();
  await page.goto(base+'/#/settings');await page.reload();await page.locator('.live-app').waitFor();await capture(page,'live-settings',config);
  if(!config.ur){await page.goto(base+'/#/scanner');await page.reload();await page.locator('.live-app').waitFor();await page.getByRole('button',{name:'Yarn spec',exact:true}).click();await capture(page,'live-scanner-spec',config);}
  await context.close();continue;
 }
 for(const route of routes){await page.goto(`${base}/?practice=1#/${route}`);await page.reload();await page.locator('h1').waitFor();await capture(page,`register-${route}`,config);}
 if(!config.ur)await legacyForms(page,config);
 await page.goto(base+'/');await page.getByLabel('Workspace name',{exact:true}).waitFor();await capture(page,'live-welcome',config);
 await page.getByLabel('Workspace name',{exact:true}).fill('QA Factory');await page.getByRole('button',{name:'Create workspace',exact:true}).last().click();await page.locator('.live-app').waitFor();
 for(const route of ['overview','inventory','scanner','activity','settings']){await page.goto(`${base}/#/${route}`);await page.reload();await page.locator('h1').waitFor();await page.getByText('Opening your workspace…',{exact:true}).waitFor({state:'hidden'});await capture(page,`live-${route}`,config);}
 if(!config.ur) {const lotId=await populate(context);await liveForms(page,config,lotId);}
 await context.close();
}
if(!before&&!linksOnly&&!dialogsOnly&&!datesOnly)await representativeStates(browser);
await browser.close();fs.writeFileSync(`${root}/audit.json`,JSON.stringify({results,errors},null,2));
const failures=results.filter(r=>r.overflow||r.violations.length||r.smallText.length||r.smallControls.length||r.purple.length||r.gradients.length||r.wrongType.length||r.nestedGlass.length||(r.solid&&(!r.reducedTransparency||r.blurs.length))||r.disabledControls.some(c=>Number(c.opacity)!==1||c.contrast<4.5));
console.log(JSON.stringify({screens:results.length,errors:errors.length,failures:failures.length}));
if(!before&&(failures.length||errors.length))process.exitCode=1;
