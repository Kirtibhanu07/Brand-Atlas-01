#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadCatalog} from './catalog.mjs';
import {run} from './cli.mjs';
import {launchBrowser} from './browser.mjs';
import {classifyFailure,mapLimit} from './resilience.mjs';

const csvCell=value=>`"${String(value??'').replaceAll('"','""')}"`;
export function summarize(site, manifest) {
  return {id:site.id,name:site.name,sport:site.sport,url:site.url,outcome:manifest.coverage.outcome,
    brands:manifest.brands.length,downloadedLogos:manifest.brands.reduce((n,b)=>n+b.logos.filter(l=>l.status==='downloaded').length,0),
    unavailableLogos:manifest.brands.reduce((n,b)=>n+b.logos.filter(l=>l.status!=='downloaded').length,0),
    reviewRequired:manifest.brands.filter(b=>b.reviewRequired).length,pagesVisited:manifest.coverage.pagesVisited,
    warnings:manifest.coverage.warnings,report:`${site.id}/index.html`,checkedAt:manifest.finishedAt};
}
export async function writeBatchReport(outputDir, sites, results, startedAt) {
  const summary={startedAt,finishedAt:new Date().toISOString(),total:sites.length,checked:results.length,
    outcomes:results.reduce((counts,r)=>(counts[r.outcome]=(counts[r.outcome]||0)+1,counts),{}),results:[...results].sort((a,b)=>a.name.localeCompare(b.name))};
  await fs.writeFile(path.join(outputDir,'coverage.json'),JSON.stringify(summary,null,2));
  const headers=['name','sport','url','outcome','brands','downloadedLogos','unavailableLogos','reviewRequired','pagesVisited'];
  await fs.writeFile(path.join(outputDir,'coverage.csv'),[headers.map(csvCell).join(','),...summary.results.map(r=>headers.map(k=>csvCell(r[k])).join(','))].join('\n')+'\n');
  const md=`# Sports website validation\n\nChecked ${results.length} of ${sites.length} catalog entries. Started ${startedAt}.\n\nThis is a bounded crawl, not a guarantee of a complete sponsor inventory. “found” means downloadable logo evidence was saved; names and relationships still need review. Blocks, robots rules and unavailable assets remain visible.\n\n| Event / league / tour | Sport | Result | Brands | Downloaded logos |\n|---|---|---|---:|---:|\n${summary.results.map(r=>`| [${r.name}](${r.url}) | ${r.sport} | ${r.outcome} | ${r.brands||0} | ${r.downloadedLogos||0} |`).join('\n')}\n`;
  await fs.writeFile(path.join(outputDir,'coverage.md'),md);
  return summary;
}

export async function runBatch(sites, options={}, dependencies={}) {
  const outputDir=path.resolve(options.output||'output/sports-batch'),startedAt=new Date().toISOString();
  await fs.mkdir(outputDir,{recursive:true});
  const browser=dependencies.browser||await launchBrowser(options.headed),results=[];
  let checkpoint=Promise.resolve();
  try {
    await mapLimit(sites,options.concurrency||2,async site=>{
      let result;
      try {
        const {manifest}=await (dependencies.scan||run)({maxPages:3,siteTimeoutMs:75_000,assetTimeoutMs:35_000,maxLogos:120,
          partnerUrls:site.partnerUrls||[],respectRobots:true,background:'black',pptx:false,zip:false,...options,url:site.url,output:path.join(outputDir,site.id)},{browser});
        result=summarize(site,manifest);
      }catch(error){result={id:site.id,name:site.name,sport:site.sport,url:site.url,outcome:classifyFailure(error),brands:0,downloadedLogos:0,warnings:[error.message],checkedAt:new Date().toISOString()};}
      results.push(result);
      // Serialize checkpoint writes so an interrupted run keeps a valid partial report.
      checkpoint=checkpoint.then(()=>writeBatchReport(outputDir,sites,results,startedAt));
      await checkpoint;
      options.onProgress?.(result,results.length,sites.length);
    });
  } finally {if(!dependencies.browser)await browser.close();}
  await checkpoint;
  return writeBatchReport(outputDir,sites,results,startedAt);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const options={};let ids;
    for(let i=2;i<process.argv.length;i++){
      const a=process.argv[i];
      if(a==='--output')options.output=process.argv[++i];
      else if(a==='--ids')ids=process.argv[++i]?.split(',');
      else if(a==='--concurrency')options.concurrency=Math.max(1,Math.min(4,Number(process.argv[++i])||2));
      else if(a==='--max-pages')options.maxPages=Math.max(1,Math.min(20,Number(process.argv[++i])||3));
      else if(a==='--pptx')options.pptx=true;
      else if(a==='--background'){options.background=process.argv[++i];if(!['white','black'].includes(options.background))throw new Error('Background must be white or black');}
      else if(a==='--headed')options.headed=true;
      else if(a==='--help'){console.log('Usage: node src/batch.mjs [--output DIR] [--ids ID,ID] [--concurrency 1-4] [--max-pages N] [--pptx] [--background white|black]');process.exit(0);}
      else throw new Error(`Unknown batch option: ${a}`);
    }
    const catalog=await loadCatalog(),sites=ids?catalog.filter(s=>ids.includes(s.id)):catalog;
    if(!sites.length||ids?.some(id=>!catalog.some(s=>s.id===id)))throw new Error('Select valid event IDs from data/sports-events.json');
    options.onProgress=(r,n,total)=>console.log(`${n}/${total} ${r.name}: ${r.outcome}; ${r.brands} brands, ${r.downloadedLogos} logos`);
    const result=await runBatch(sites,options);console.log(JSON.stringify(result.outcomes));
  }catch(error){console.error(`Batch scan could not start: ${error.message}`);process.exitCode=1;}
}
