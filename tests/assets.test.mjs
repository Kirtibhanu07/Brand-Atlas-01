import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {normalizeLogo,cropSprite,assetKey,unavailableLogo} from '../src/assets.mjs';
import {mergeCandidates} from '../src/records.mjs';

test('rejects HTML challenges and tracking pixels instead of exporting corrupt logos',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'brand-assets-'));
 try{
  const candidate={sourceUrl:'https://cdn.example/logo.png',sourcePage:'https://event.example',name:'Acme'};
  await assert.rejects(normalizeLogo(candidate,dir,1,{fetcher:async()=>({status:200,headers:{'content-type':'text/html'},body:Buffer.from('<html>Bot challenge</html>')})}));
  const pixel=await sharp({create:{width:1,height:1,channels:4,background:'#ffffff'}}).png().toBuffer();
  await assert.rejects(normalizeLogo({...candidate,sourceUrl:`data:image/png;base64,${pixel.toString('base64')}`},dir,2),/too small/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('keeps original white transparent logo bytes and produces a valid PNG preview',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'brand-alpha-'));
 try{
  const body=await sharp({create:{width:80,height:40,channels:4,background:{r:255,g:255,b:255,alpha:.5}}}).png().toBuffer();
  const logo=await normalizeLogo({name:'White brand',sourceUrl:`data:image/png;base64,${body.toString('base64')}`},dir,1);
  assert.deepEqual(await fs.readFile(path.join(dir,logo.path)),body);
  const meta=await sharp(await fs.readFile(path.join(dir,logo.previewPath))).metadata();assert.equal(meta.format,'png');assert.equal(meta.hasAlpha,true);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('extracts distinct logos from one CSS sprite without deduplicating them together',async()=>{
 const body=await sharp({create:{width:40,height:20,channels:4,background:'red'}}).composite([{input:await sharp({create:{width:20,height:20,channels:4,background:'blue'}}).png().toBuffer(),left:20,top:0}]).png().toBuffer();
 const a={sourceUrl:'https://cdn.example/sprite.png',crop:{position:'0px 0px',size:'40px 20px',width:20,height:20}};
 const b={...a,crop:{...a.crop,position:'-20px 0px'}};
 const first=await sharp(await cropSprite(body,a.crop)).raw().toBuffer(),second=await sharp(await cropSprite(body,b.crop)).raw().toBuffer();
 assert.equal(first[0],255);assert.equal(second[2],255);assert.notEqual(assetKey(a),assetKey(b));
 await assert.rejects(cropSprite(body,{...a.crop,position:'-100px 0px'}),/outside/);
});
test('unavailable and unknown logos remain separate reviewable evidence records',()=>{
 const records=['https://cdn.example/a.png','https://cdn.example/b.png'].map(sourceUrl=>({name:'Unknown logo',nameSource:'unavailable',confidence:.25,reviewRequired:true,relationship:'Partner',section:'Partners',sourcePage:'https://event.example',sourceUrl,logo:unavailableLogo({sourceUrl},new Error('blocked'))}));
 assert.equal(mergeCandidates(records).length,2);
});
