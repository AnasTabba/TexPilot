const CACHE='yarnflow-shell-v1';
// The build replaces this exact list with public, content-hashed assets. No wildcard caching.
const PUBLIC_SHELL=['/','/icon.svg'];
const publicURL=url=>url.origin===self.location.origin&&!url.search&&!url.hash&&PUBLIC_SHELL.includes(url.pathname);
// The SPA fallback answers missing files with index.html and 200, so HTML must not be stored
// under an asset path (a deleted chunk would then be served as HTML forever).
const cacheable=(response,path)=>response.ok&&response.type!=='opaque'&&!/(?:no-store|private)/i.test(response.headers.get('Cache-Control')||'')&&!(/text\/html/i.test(response.headers.get('Content-Type')||'')&&path!=='/'&&path!=='/offline.html');
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(async storage=>{
 // Filter even install responses: Cache.addAll itself ignores Cache-Control: no-store.
 const cache={addAll:async paths=>{for(const path of paths){const response=await fetch(path,{cache:'no-cache',credentials:'omit'});if(cacheable(response,path))await storage.put(path,response);}}};
 await cache.addAll(['/','/icon.svg']);
}));});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith('yarnflow-')&&name!==CACHE)await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.pathname.startsWith('/api/')||request.cache==='no-store'||!publicURL(url))return;
 event.respondWith((async()=>{
  try{const response=await fetch(request);if(cacheable(response,url.pathname)){const cache=await caches.open(CACHE);await cache.put(request,response.clone());}return response;}
  catch{const cache=await caches.open(CACHE);return(await cache.match(request))||(request.mode==='navigate'?await cache.match('/offline.html'):null)||Response.error();}
 })());
});
