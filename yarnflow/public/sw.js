const CACHE='yarnflow-shell-v1';
// The build replaces this exact list with public, content-hashed assets. No wildcard caching.
const PUBLIC_SHELL=['/','/icon.svg'];
const publicURL=url=>url.origin===self.location.origin&&!url.search&&!url.hash&&PUBLIC_SHELL.includes(url.pathname);
const cacheable=response=>response.ok&&response.type!=='opaque'&&!/(?:no-store|private)/i.test(response.headers.get('Cache-Control')||'');
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(async storage=>{
 // Filter even install responses: Cache.addAll itself ignores Cache-Control: no-store.
 const cache={addAll:async paths=>{for(const path of paths){const response=await fetch(path,{cache:'no-cache',credentials:'omit'});if(cacheable(response))await storage.put(path,response);}}};
 await cache.addAll(['/','/icon.svg']);
})));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith('yarnflow-')&&name!==CACHE)await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.pathname.startsWith('/api/')||request.cache==='no-store'||!publicURL(url))return;
 event.respondWith((async()=>{
  try{const response=await fetch(request);if(cacheable(response)){const cache=await caches.open(CACHE);await cache.put(request,response.clone());}return response;}
  catch{const cache=await caches.open(CACHE);return(await cache.match(request))||Response.error();}
 })());
});
