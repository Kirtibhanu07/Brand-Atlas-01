import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {mapLimit,retry,classifyFailure} from '../src/resilience.mjs';
import {robotsCache,pageOutcome} from '../src/browser.mjs';
import {loadCatalog} from '../src/catalog.mjs';
import {runBatch} from '../src/batch.mjs';

test('bounded workers isolate failures, preserve order and never exceed concurrency', async()=>{
 let active=0,peak=0;
 const result=await mapLimit([1,2,3,4],2,async n=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;if(n===2)throw new Error('site unavailable');return n*2;});
 assert.equal(peak,2);assert.equal(result[1].status,'rejected');assert.equal(result[3].value,8);
});
test('retry stops after bounded attempts and never retries permanent failures',async()=>{
 let count=0;const delays=[];
 const result=await retry(async()=>{if(++count<3)throw new Error('temporary');return 'saved';},{attempts:3,pause:async ms=>delays.push(ms)});
 assert.equal(result,'saved');assert.deepEqual(delays,[400,800]);
 count=0;await assert.rejects(retry(async()=>{count++;throw new Error('blocked');},{shouldRetry:()=>false}),/blocked/);assert.equal(count,1);
});
test('robots retrieval is cached per origin, fails closed, and preserves path rules',async()=>{
 let calls=0;
 const policyFor=robotsCache({fetcher:async()=>{calls++;return {status:200,body:Buffer.from('User-agent: *\nDisallow: /private\nAllow: /private/partners')};}});
 const a=await policyFor('https://event.example/private'),b=await policyFor('https://event.example/');
 assert.equal(calls,1);assert.equal(a,b);assert.equal(a.isAllowed('https://event.example/private/file'),false);assert.equal(a.isAllowed('https://event.example/private/partners'),true);
 const unavailable=robotsCache({fetcher:async()=>{throw new Error('timeout');}});
 assert.equal((await unavailable('https://event.example')).isAllowed('https://event.example'),false);
 const denied=robotsCache({fetcher:async()=>({status:403})});assert.equal((await denied('https://event.example')).isAllowed('/'),false);
});
test('blocked, parked, throttled and empty pages never count as successful scrapes',()=>{
 assert.equal(pageOutcome({status:403}),'blocked');assert.equal(pageOutcome({status:429}),'rate_limited');
 assert.equal(pageOutcome({status:200,title:'Verify you are human'}),'blocked');
 assert.equal(pageOutcome({status:200,text:'Domain for sale'}),'parked_domain');
 assert.equal(pageOutcome({status:200,candidates:[]}),'no_evidence');
 assert.equal(classifyFailure(new Error('Request timed out')),'timeout');
});
test('catalog has at least 50 distinct named events and spans at least ten sports',async()=>{
 const events=await loadCatalog();assert.ok(events.length>=50);assert.equal(new Set(events.map(e=>e.id)).size,events.length);assert.ok(new Set(events.map(e=>e.sport)).size>=10);
});
test('batch preserves good reports when another event fails and writes a valid checkpoint',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'brand-batch-'));
 const sites=[{id:'first',name:'First',sport:'Tennis',url:'https://first.example'},{id:'second',name:'Second',sport:'Golf',url:'https://second.example'}];
 try{
  const summary=await runBatch(sites,{output:dir,concurrency:2},{browser:{},scan:async options=>{
   if(options.url.includes('second'))throw new Error('DNS ENOTFOUND');
   return {manifest:{finishedAt:'2026-10-23',brands:[],coverage:{outcome:'no_evidence',pagesVisited:1,warnings:[]}}};
  }});
  assert.equal(summary.checked,2);assert.equal(summary.outcomes.dns_error,1);
  const saved=JSON.parse(await fs.readFile(path.join(dir,'coverage.json')));assert.equal(saved.results.length,2);
  assert.match(await fs.readFile(path.join(dir,'coverage.csv'),'utf8'),/First/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('consent helper rejects optional cookies without interacting with unrelated buttons',async t=>{
 const {launchBrowser,dismissConsent}=await import('../src/browser.mjs');
 const browser=await launchBrowser();t.after(()=>browser.close());const page=await browser.newPage();
 await page.setContent('<button id="onetrust-reject-all-handler" onclick="this.remove()">Reject optional cookies</button><button>Accept terms</button>');
 assert.equal(await dismissConsent(page),true);assert.equal(await page.getByText('Accept terms').count(),1);
});
