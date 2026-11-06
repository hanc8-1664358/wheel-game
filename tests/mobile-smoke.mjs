import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const html=await readFile(new URL('../lucky_spin.html',import.meta.url));
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(join(tmpdir(),'wheel-mobile-test-'));
const browser=spawn(process.env.CHROMIUM_PATH||'chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank']);
try {
const endpoint=await new Promise((resolve,reject)=>{
 let output='';const timeout=setTimeout(()=>reject(new Error('Chromium startup timed out')),15000);
 browser.on('error',error=>{clearTimeout(timeout);reject(error)});
 browser.stderr.on('data',data=>{output+=data;const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
});
const debugOrigin=new URL(endpoint).origin.replace('ws:','http:');
const targets=await (await fetch(`${debugOrigin}/json`)).json();
const ws=new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0;const pending=new Map();const errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);};
const send=(method,params={})=>new Promise(r=>{pending.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.result.exceptionDetails,JSON.stringify(r));return r.result.result.value;};
await send('Runtime.enable');await send('Page.enable');
await send('Page.navigate',{url:`${origin}/lucky_spin.html`});
await new Promise(r=>setTimeout(r,1000));
for(const [width,height] of [[320,640],[375,667],[390,844],[430,932],[844,390],[1280,800]]){
 await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:width<900});
 await send('Page.reload');await new Promise(r=>setTimeout(r,350));
 assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),`overflow at ${width}`);
 if(width<=560){
  assert(await evaluate('getComputedStyle(document.getElementById("editorBody")).display==="none"'));
  await evaluate('document.getElementById("editorToggle").click()');
  assert(await evaluate('getComputedStyle(document.getElementById("editorBody")).display!=="none"'));
  assert(await evaluate('parseFloat(getComputedStyle(document.querySelector(".entry-row input")).fontSize)>=16'));
  assert(await evaluate('[...document.querySelectorAll(".delete-btn, .mode-btn")].every(e=>e.getBoundingClientRect().height>=44)'));
 }
 assert(await evaluate('document.getElementById("wheel").width>0'));
 if(width<=560)assert(await evaluate('[...document.querySelectorAll(".entry-row input,.delete-btn")].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})'),`card controls clipped at ${width}`);
 console.log(`PASS layout ${width}x${height}`);
}
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true});
await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
await send('Page.reload');await new Promise(r=>setTimeout(r,300));
// Real touch cancellation must not start a spin.
await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:110,y:290}]});
await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:145,y:260}]});
await send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
assert.equal(await evaluate('document.getElementById("spinBtn").disabled'),false,'canceled touch started spin');
// Other pointer IDs must not end the active drag.
await evaluate(`(()=>{const c=document.getElementById('wheel');for(const [type,id,x,y] of [['pointerdown',31,110,290],['pointermove',31,145,260],['pointerup',32,145,260]])c.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:x,clientY:y,button:0,isPrimary:true}));})()`);
assert.equal(await evaluate('document.getElementById("spinBtn").disabled'),false);
await evaluate(`document.getElementById('wheel').dispatchEvent(new PointerEvent('pointercancel',{pointerId:31}))`);
await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:110,y:290}]});
await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:155,y:255}]});
await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
assert.equal(await evaluate('document.getElementById("spinBtn").disabled'),true,'swipe did not start spin');
await new Promise(r=>setTimeout(r,8500));
assert(await evaluate('document.getElementById("resultModal").classList.contains("show")'));
await send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:2,mobile:true});
await new Promise(r=>setTimeout(r,200));
assert(await evaluate('(()=>{const r=document.getElementById("resultCard").getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()'),'landscape result clipped');
assert.equal(errors.length,0,JSON.stringify(errors));
await evaluate('document.getElementById("closeResultBtn").click()');
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await evaluate('document.getElementById("editorToggle").click();document.getElementById("addBtn").click();document.getElementById("equalMode").click()');
const label='手机保存测试';
await evaluate(`(()=>{const input=document.querySelector('#entryList input[type=text]');input.value=${JSON.stringify(label)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await send('Page.reload');await new Promise(r=>setTimeout(r,350));
assert.equal(await evaluate('document.querySelectorAll("#entryList input[type=text]").length'),7);
assert.equal(await evaluate('document.querySelector("#entryList input[type=text]").value'),label);
assert.equal(await evaluate('JSON.parse(localStorage.getItem("lucky-spin-config-v1")).mode'),'equal');
assert.equal(await evaluate('JSON.parse(localStorage.getItem("lucky-spin-history-v1")).length'),1);
console.log('PASS mobile edits, probability mode and history persist across reload');
console.log('PASS touch cancel, unrelated pointer, real swipe, result dialog, landscape fit; no browser exceptions');
ws.close();

} finally {
 browser.kill('SIGTERM');
 await new Promise(r=>{if(browser.exitCode!==null||browser.signalCode!==null)r();else browser.once('exit',r)});
 await new Promise(r=>server.close(r));
 await rm(profile,{recursive:true,force:true});
}
