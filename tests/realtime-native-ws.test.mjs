import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { registerHooks } from 'node:module';
import { WebSocketServer } from 'ws';
const hooks=registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL?.includes('/src/')&&!s.endsWith('.ts')){try{return next(s+'.ts',c)}catch{}}return next(s,c)}});
const {RealtimeSessionManager,createVoiceSocket}=await import('../src/main/realtime-session.ts');
const ID='11111111-1111-4111-8111-111111111111';
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return `ws://127.0.0.1:${server.address().port}`;}
async function close(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
function manager(origin,expiry=60000,setupTimeoutMs){let count=0,socket;const events=[];let identity={epoch:0,profileId:'synthetic',owner:1};
 const m=new RealtimeSessionManager({...(setupTimeoutMs?{setupTimeoutMs}:{}),identity:()=>identity,models:()=>[{id:'gpt-realtime-2.1-mini',type:'realtime'}],emit:e=>events.push(e),
 fetch:async()=>{count++;return Response.json({object:'gateway.live_session',model:'gpt-realtime-2.1-mini',token:'synthetic_native_ws_one_use',expires_at:new Date(Date.now()+expiry).toISOString(),url:'/v1/gateway/realtime?model=gpt-realtime-2.1-mini'})},
 socket:url=>{const remote=new URL(url);socket=createVoiceSocket(origin+remote.pathname+remote.search);return socket;}});
 return {m,events,count:()=>count,socket:()=>socket,change:()=>{identity={epoch:1,profileId:'other',owner:1};m.abort()}};}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function settle(f){for(let n=0;n<1500;n++){if(f.m.size===0&&f.socket().readyState===3&&f.socket().eventNames().length===0)return;await delay(2)}throw new Error('synthetic socket did not settle');}
test('actual pinned ws never follows same/cross-origin 301/302/303/307/308 or exposes redirect URL in IPC',async()=>{
 for(const status of [301,302,303,307,308])for(const cross of [false,true]){
  let first=0,target=0,tokenRequests=0;const other=createServer((req,res)=>{target++;if(new URL(req.url,'http://local').searchParams.has('token'))tokenRequests++;res.writeHead(403);res.end()});const otherOrigin=await listen(other);
  let origin;const initial=createServer((req,res)=>{if(req.url.startsWith('/v1/gateway/realtime')){first++;res.writeHead(status,{Location:(cross?otherOrigin:origin).replace('ws:','http:')+'/target?token=synthetic_redirect_marker'});res.end()}else{target++;res.writeHead(403);res.end()}});origin=await listen(initial);const f=manager(origin);
  try {f.m.begin({id:ID,modelId:'gpt-realtime-2.1-mini',consent:true});await f.m.connect(ID,'synthetic');await settle(f);assert.equal(first,1);assert.equal(target,0);assert.equal(tokenRequests,0);assert.equal(f.count(),1);assert.equal(f.m.size,0);assert.equal(f.socket().eventNames().length,0);assert.equal(JSON.stringify(f.events).includes('token='),false);assert.equal(JSON.stringify(f.events).includes('127.0.0.1'),false);}
  finally{f.m.abort();await close(initial);await close(other)}
 }
});
test('native connecting abort/account teardown/expiry timeout settles async error and close guards without retained listeners',async()=>{
 for(const mode of ['cancel','account','timeout']){
  let requests=0;const sockets=new Set();const server=createServer((req,_res)=>{requests++});server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s))});const origin=await listen(server);const f=manager(origin,mode==='timeout'?80:60000,mode==='timeout'?100:undefined);
  try{f.m.begin({id:ID,modelId:'gpt-realtime-2.1-mini',consent:true});await f.m.connect(ID,'synthetic');while(requests===0)await delay(2);
   if(mode==='cancel')f.m.stop(ID,true);if(mode==='account')f.change();await settle(f);assert.equal(f.m.size,0);assert.equal(f.count(),1);assert.equal(requests,1);assert.equal(f.socket().eventNames().length,0);assert.equal(JSON.stringify(f.events).includes('token='),false);
  }finally{f.m.abort();for(const s of sockets)s.destroy();await close(server)}
 }
});
test('native ws maxPayload rejects oversized server frame before renderer forwarding',async()=>{
 const server=createServer();const ws=new WebSocketServer({server});ws.on('connection',s=>{s.on('error',()=>{});s.send(Buffer.alloc(262145))});const origin=await listen(server);const f=manager(origin);
 try{f.m.begin({id:ID,modelId:'gpt-realtime-2.1-mini',consent:true});await f.m.connect(ID,'synthetic');await settle(f);assert.equal(f.m.size,0);assert.equal(f.events.some(e=>e.type==='audio'),false);assert.equal(f.socket().eventNames().length,0)}
 finally{f.m.abort();for(const s of ws.clients)s.terminate();await new Promise(r=>ws.close(r));await close(server)}
});
test.after(()=>hooks.deregister());
