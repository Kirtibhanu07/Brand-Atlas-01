import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {safeFetch} from './network.mjs';
import {retry,TRANSIENT_STATUS} from './resilience.mjs';
import {slug} from './records.mjs';

sharp.cache({memory:16});
sharp.concurrency(1);

export const digest = body => crypto.createHash('sha256').update(body).digest('hex');
export const assetKey = candidate => candidate.kind==='inline-svg' ? digest(Buffer.from(candidate.inlineSvg||'')) : `${candidate.sourceUrl}|${JSON.stringify(candidate.crop||{})}`;

export async function cropSprite(body, crop) {
  const image=sharp(body,{limitInputPixels:16_000_000});const meta=await image.metadata();
  const w=Math.max(1,Number(crop.width)||0),h=Math.max(1,Number(crop.height)||0);
  if(w>2000||h>2000)throw new Error('Sprite viewport is too large');
  const parts=String(crop.size||'auto').split(/\s+/);
  const size=(value,container,natural)=>value?.endsWith('%')?container*parseFloat(value)/100:value?.endsWith('px')?parseFloat(value):natural;
  let sw=size(parts[0],w,meta.width),sh=size(parts[1],h,meta.height);
  if(['cover','contain'].includes(parts[0])){const ratio=(parts[0]==='cover'?Math.max:Math.min)(w/meta.width,h/meta.height);sw=meta.width*ratio;sh=meta.height*ratio;}
  if(parts[0]?.endsWith('px')&&(!parts[1]||parts[1]==='auto'))sh=meta.height*sw/meta.width;
  if(parts[1]?.endsWith('px')&&parts[0]==='auto')sw=meta.width*sh/meta.height;
  sw=Math.round(sw);sh=Math.round(sh);
  if(sw*sh>16_000_000)throw new Error('Sprite raster size limit exceeded');
  const position=String(crop.position||'0px 0px').split(/\s+/);
  const offset=(value,total,viewport)=>value?.endsWith('%')?Math.round((total-viewport)*parseFloat(value)/100):Math.round(-parseFloat(value||0));
  const left=offset(position[0],sw,w),top=offset(position[1],sh,h);
  if(left<0||top<0||left+w>sw||top+h>sh)throw new Error('Sprite coordinates lie outside the source image');
  return image.resize(sw,sh).extract({left,top,width:w,height:h}).png().toBuffer();
}

export function decodeDataImage(value) {
  const match=String(value).match(/^data:(image\/[a-z0-9.+-]+)(?:;charset=[^;,]+)?(;base64)?,(.*)$/is);
  if(!match)throw new Error('Unsupported embedded image data');
  const body=match[2]?Buffer.from(match[3],'base64'):Buffer.from(decodeURIComponent(match[3]));
  if(body.length>10_000_000)throw new Error('Embedded image exceeded 10000000 bytes');
  return {body,mime:match[1].toLowerCase()};
}

export async function normalizeLogo(candidate, outputDir, ordinal, {fetcher=safeFetch,timeoutMs=8000} = {}) {
  let body,mime='';
  if(candidate.kind==='inline-svg'){body=Buffer.from(candidate.inlineSvg||'');mime='image/svg+xml';}
  else if(String(candidate.sourceUrl).startsWith('data:image/'))({body,mime}=decodeDataImage(candidate.sourceUrl));
  else {
    if(!/^https?:/i.test(candidate.sourceUrl||''))throw new Error('Logo has no downloadable HTTP URL');
    const response=await retry(async()=>{
      const res=await fetcher(candidate.sourceUrl,{maxBytes:10_000_000,timeoutMs,headers:{referer:candidate.sourcePage}});
      if(TRANSIENT_STATUS.has(res.status)&&res.status!==429)throw new Error(`Temporary logo HTTP ${res.status}`);
      return res;
    },{attempts:2,shouldRetry:error=>/timed out|ECONNRESET|Temporary logo HTTP|EAI_AGAIN/i.test(error.message)});
    if(response.status<200||response.status>=300)throw new Error(`Logo download returned HTTP ${response.status}`);
    body=response.body;mime=String(response.headers['content-type']||'').split(';')[0].toLowerCase();
  }
  const original = body;
  if(candidate.crop) {body=await cropSprite(body,candidate.crop);mime='image/png';}
  // A 200 response containing a bot challenge, HTML or a tracking pixel is not a logo.
  const image=sharp(body,{animated:false,limitInputPixels:16_000_000});
  const meta=await image.metadata();
  if((meta.width||0)<8||(meta.height||0)<8)throw new Error('Asset is too small to be a usable logo');
  const ext={svg:'svg',jpeg:'jpg',png:'png',webp:'webp',gif:'gif',avif:'avif',tiff:'tiff'}[meta.format];
  if(!ext)throw new Error(`Unsupported logo format: ${meta.format}`);
  const sha256=digest(body),base=`${String(ordinal).padStart(3,'0')}-${slug(candidate.name)}-${sha256.slice(0,8)}`;
  const rel=`logos/${base}.${ext}`, previewRel=`previews/${base}.png`;
  await fs.mkdir(path.join(outputDir,'logos'),{recursive:true});
  await fs.mkdir(path.join(outputDir,'previews'),{recursive:true});
  await fs.writeFile(path.join(outputDir,rel),body);
  let originalPath;
  if(candidate.crop){originalPath=`logos/sprite-source-${digest(original).slice(0,16)}.bin`;await fs.writeFile(path.join(outputDir,originalPath),original);}
  let previewPath,previewError;
  try{
    await image.resize(900,420,{fit:'inside'}).png().toFile(path.join(outputDir,previewRel));
    previewPath=previewRel;
  }catch(error){previewError=`PNG preview unavailable: ${error.message}`;}
  return {path:rel,previewPath,originalPath,sha256,mimeType:mime||`image/${ext}`,sourceUrl:candidate.sourceUrl,status:'downloaded',width:meta.width,height:meta.height,...(previewError?{previewError}:{})};
}

export function unavailableLogo(candidate,error) {
  return {sha256:`unavailable-${digest(Buffer.from(assetKey(candidate)))}`,sourceUrl:candidate.sourceUrl,status:'unavailable',error:String(error.message||error)};
}
