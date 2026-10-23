#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeUrl, safeFetch } from "./network.mjs";
import { crawlSite, launchBrowser } from "./browser.mjs";
import { normalizeLogo, unavailableLogo, assetKey } from "./assets.mjs";
import { loadCatalog } from "./catalog.mjs";
import { mapLimit } from "./resilience.mjs";
import { exportReport } from "./export.mjs";
import { mergeCandidates } from "./records.mjs";

function usage() {
  return `Brand Atlas\n\nUsage:\n  node src/cli.mjs <website> [--output DIR] [--max-pages N] [--site-timeout SECONDS] [--overrides FILE] [--background white|black] [--headed] [--no-pptx] [--no-zip] [--ignore-robots]\n\nExample:\n  node src/cli.mjs https://premierpadel.com/en/home-page --output output/premier-padel`;
}

export function parseArgs(argv) {
  const args = { url: "", output: "", overrides: "", maxPages: 12, background: "white", headed: false, pptx: true, zip: true, respectRobots: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-") && !args.url) args.url = a;
    else if (a === "--output") args.output = argv[++i] || "";
    else if (a === "--site-timeout") args.siteTimeoutMs = Math.max(10, Math.min(600, Number(argv[++i]) || 120)) * 1000;
    else if (a === "--max-pages") args.maxPages = Math.max(1, Math.min(100, Number(argv[++i]) || 12));
    else if (a === "--overrides") args.overrides = argv[++i] || "";
    else if (a === "--background") {
      args.background = argv[++i];
      if (!["white", "black"].includes(args.background)) throw new Error("Background must be white or black");
    }
    else if (a === "--headed") args.headed = true;
    else if (a === "--no-pptx") args.pptx = false;
    else if (a === "--no-zip") args.zip = false;
    else if (a === "--ignore-robots") args.respectRobots = false;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  if (!args.output) args.output = path.resolve("output", args.url ? new URL(normalizeUrl(args.url)).hostname.replace(/^www\./, "") : "run");
  return args;
}

async function applyOverrides(records, file) {
  if (!file) return records;
  const config = JSON.parse(await fs.readFile(path.resolve(file), "utf8"));
  return records.flatMap((record) => {
    const override = config[record.logo.sha256] || config[record.sourceUrl] || config[record.name];
    if (override?.ignore) return [];
    if (!override) return [record];
    return [{...record, ...override, logo:record.logo, reviewRequired:override.reviewRequired ?? false, confidence:override.confidence ?? 1, nameSource:"review override"}];
  });
}

export async function run(options, dependencies = {}) {
  const startedAt=new Date().toISOString(),root=normalizeUrl(options.url),outputDir=path.resolve(options.output);
  await fs.mkdir(outputDir,{recursive:true});
  const browser=dependencies.browser || await launchBrowser(options.headed);
  let crawl;
  try {
    const profile=(await loadCatalog()).find(site=>new URL(site.url).hostname.replace(/^www\./, "")===new URL(root).hostname.replace(/^www\./, ""));
    crawl=await crawlSite(browser,root,{...options,partnerUrls:options.partnerUrls || profile?.partnerUrls || []});
  }
  finally {if(!dependencies.browser)await browser.close();}
  const warnings=[...crawl.warnings];
  const uniqueAssets=new Map();
  const downloads=new Map();
  const spriteSources=new Set(crawl.candidates.filter(c=>c.crop).map(c=>c.sourceUrl));
  const fetcher=(url,opts)=>{if(!spriteSources.has(url))return safeFetch(url,opts);if(!downloads.has(url))downloads.set(url,safeFetch(url,opts).catch(error=>{downloads.delete(url);throw error;}));return downloads.get(url);};
  for(const c of crawl.candidates){
    const key=assetKey(c);
    if(!uniqueAssets.has(key))uniqueAssets.set(key,c);
  }
  const deadline=Date.now()+(options.assetTimeoutMs||60_000),assetMap=new Map();
  const jobs=[...uniqueAssets.entries()].slice(0,options.maxLogos||250);
  await mapLimit(jobs,2,async([key,c],index)=>{
    try {
      if(Date.now()>=deadline)throw new Error('Logo download time budget reached');
      const logo=await normalizeLogo(c,outputDir,index+1,{fetcher,timeoutMs:Math.min(8000,Math.max(1000,deadline-Date.now()))});
      assetMap.set(key,logo);
      if(logo.previewError)warnings.push(`${c.name}: ${logo.previewError}`);
    } catch(error){assetMap.set(key,unavailableLogo(c,error));warnings.push(`${c.name}: ${error.message}`);}
  });
  if(uniqueAssets.size>jobs.length)warnings.push(`Logo limit reached: ${jobs.length} of ${uniqueAssets.size} distinct assets were attempted.`);
  const normalized=crawl.candidates.map(c=>{
    const key=assetKey(c);
    const logo=assetMap.get(key)||unavailableLogo(c,new Error('Logo limit reached'));
    return {...c,logo};
  });
  const reviewed=await applyOverrides(normalized,options.overrides),brands=mergeCandidates(reviewed);
  const downloaded=brands.filter(b=>b.logos.some(l=>l.status==='downloaded')).length;
  const failedPages=crawl.pages.filter(p=>!['found','no_evidence'].includes(p.outcome));
  for(const p of failedPages)warnings.push(`${p.url}: ${p.outcome}${p.error?` — ${p.error}`:''}`);
  if(!brands.length)warnings.push('No sponsor evidence was extracted. This does not mean that the event has no sponsors.');
  const outcome=brands.length?(downloaded?'found':'assets_unavailable'):crawl.pages.find(p=>['blocked','rate_limited','robots_disallowed','robots_unavailable'].includes(p.outcome))?.outcome||
    (crawl.pages.some(p=>p.outcome==='no_evidence')?'no_evidence':crawl.pages[0]?.outcome||'no_evidence');
  const manifest={schemaVersion:'1.1',sourceUrl:root,startedAt,finishedAt:new Date().toISOString(),
    options:{background:options.background||'white',maxPages:options.maxPages||8,respectRobots:options.respectRobots!==false},
    coverage:{status:failedPages.length||downloaded<brands.length?'partial':'bounded',outcome,pagesVisited:crawl.pages.length,pagesDiscovered:crawl.pagesDiscovered,limitReached:crawl.limitReached,brandsWithDownloadedLogos:downloaded,warnings:[...new Set(warnings)]},pages:crawl.pages,brands};
  const files=await exportReport(manifest,outputDir,{pptx:options.pptx,zip:options.zip});
  return {manifest,outputDir,files};
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const options = parseArgs(process.argv.slice(2)); if (options.help || !options.url) { console.log(usage()); process.exit(options.help ? 0 : 1); }
    const result = await run(options); console.log(`Found ${result.manifest.brands.length} brand records across ${result.manifest.coverage.pagesVisited} pages.`); console.log(`Report: ${path.join(result.outputDir,"index.html")}`);
  } catch (e) { console.error(`Brand Atlas failed: ${e.message}`); process.exit(1); }
}
