#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright";
import sharp from "sharp";
import { assertPublicUrl, normalizeUrl, parseRobots, safeFetch } from "./network.mjs";
import { extractPage } from "./extract.mjs";
import { exportReport } from "./export.mjs";

function usage() {
  return `Brand Atlas\n\nUsage:\n  node src/cli.mjs <website> [--output DIR] [--max-pages N] [--overrides FILE] [--headed] [--no-pptx] [--no-zip] [--ignore-robots]\n\nExample:\n  node src/cli.mjs https://premierpadel.com/en/home-page --output output/premier-padel`;
}

export function parseArgs(argv) {
  const args = { url: "", output: "", overrides: "", maxPages: 12, headed: false, pptx: true, zip: true, respectRobots: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-") && !args.url) args.url = a;
    else if (a === "--output") args.output = argv[++i] || "";
    else if (a === "--max-pages") args.maxPages = Math.max(1, Math.min(100, Number(argv[++i]) || 12));
    else if (a === "--overrides") args.overrides = argv[++i] || "";
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

const slug = (s) => s.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 70) || "unknown-logo";
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");

async function browserInstance(headed) {
  try { return await chromium.launch({ headless: !headed }); }
  catch (first) {
    const candidates = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
    for (const chrome of candidates) {
      try { await fs.access(chrome); return await chromium.launch({ headless: !headed, executablePath: chrome, args: ["--no-sandbox", "--disable-dev-shm-usage"] }); }
      catch {}
    }
    throw new Error(`Could not launch Chromium. Run: npx playwright install chromium\n${first.message}`);
  }
}

async function normalizeLogo(candidate, outputDir, ordinal) {
  let body, mime = "";
  if (candidate.kind === "inline-svg") { body = Buffer.from(candidate.inlineSvg); mime = "image/svg+xml"; }
  else {
    if (!candidate.sourceUrl || !/^https?:/i.test(candidate.sourceUrl)) throw new Error("Logo has no downloadable HTTP URL");
    const response = await safeFetch(candidate.sourceUrl, { maxBytes: 10_000_000, headers: { referer: candidate.sourcePage } });
    if (response.status < 200 || response.status >= 300) throw new Error(`Logo download returned HTTP ${response.status}`);
    body = response.body; mime = String(response.headers["content-type"] || "").split(";")[0].toLowerCase();
  }
  const digest = hash(body); let ext = mime.includes("svg") || body.subarray(0,200).toString().includes("<svg") ? "svg" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : mime.includes("jpeg") ? "jpg" : "png";
  const base = `${String(ordinal).padStart(3,"0")}-${slug(candidate.name)}-${digest.slice(0,8)}`;
  const rel = path.join("logos", `${base}.${ext}`), previewRel = path.join("previews", `${base}.png`);
  await fs.mkdir(path.join(outputDir, "logos"), { recursive: true }); await fs.mkdir(path.join(outputDir, "previews"), { recursive: true });
  await fs.writeFile(path.join(outputDir, rel), body);
  let info = {};
  try {
    const image = sharp(body, { animated: false }); const meta = await image.metadata(); info = { width: meta.width, height: meta.height };
    await image.resize(900, 420, { fit: "inside", withoutEnlargement: false }).png().toFile(path.join(outputDir, previewRel));
  } catch { await fs.copyFile(path.join(outputDir, rel), path.join(outputDir, previewRel)).catch(() => {}); }
  return { path: rel, previewPath: previewRel, sha256: digest, mimeType: mime || `image/${ext}`, sourceUrl: candidate.sourceUrl, status: "downloaded", ...info };
}

function mergeCandidates(records) {
  const map = new Map();
  for (const r of records) {
    const key = r.name.toLowerCase().replace(/[^a-z0-9]+/g, "") || r.logo.sha256;
    let b = map.get(key);
    if (!b) {
      b = { id: slug(r.name), name: r.name, nameSource: r.nameSource, confidence: r.confidence, reviewRequired: r.reviewRequired, relationship: r.relationship, relationships: [r.relationship], section: r.section, brandUrl: r.brandUrl, evidence: [], logos: [] }; map.set(key, b);
    }
    if (!b.relationships.includes(r.relationship)) { b.relationships.push(r.relationship); b.relationship = b.relationships.join("; "); }
    b.confidence = Math.max(b.confidence, r.confidence); b.reviewRequired = b.reviewRequired && r.reviewRequired;
    if (!b.brandUrl && r.brandUrl) b.brandUrl = r.brandUrl;
    if (!b.evidence.some((e) => e.sourcePage === r.sourcePage && e.sourceUrl === r.sourceUrl)) b.evidence.push({ sourcePage: r.sourcePage, sourceUrl: r.sourceUrl, section: r.section, text: r.evidence });
    if (!b.logos.some((l) => l.sha256 === r.logo.sha256)) b.logos.push(r.logo);
  }
  return [...map.values()].sort((a,b) => a.relationship.localeCompare(b.relationship) || a.name.localeCompare(b.name));
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

export async function run(options) {
  const startedAt = new Date().toISOString(), root = normalizeUrl(options.url); await assertPublicUrl(root);
  const outputDir = path.resolve(options.output); await fs.mkdir(outputDir, { recursive: true });
  const warnings = [], pages = [], candidates = []; const origin = new URL(root).origin;
  let robots = { isAllowed: () => true, crawlDelayMs: 0, sitemaps: [] };
  if (options.respectRobots) {
    try { const res = await safeFetch(`${origin}/robots.txt`, {maxBytes: 500_000}); if (res.status === 200) robots = parseRobots(res.body.toString("utf8")); else warnings.push(`robots.txt returned HTTP ${res.status}.`); }
    catch (e) { warnings.push(`robots.txt could not be read: ${e.message}`); }
  }
  if (!robots.isAllowed(root)) throw new Error("robots.txt disallows crawling the supplied URL for BrandAtlas");
  const browser = await browserInstance(options.headed); const context = await browser.newContext({ viewport: {width: 1440,height: 1000}, serviceWorkers: "block" });
  const dnsCache = new Map();
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (/^(data|blob|about):/.test(url)) return route.continue();
    if (!/^https?:/.test(url)) return route.abort("blockedbyclient");
    try { const host = new URL(url).hostname; if (!dnsCache.has(host)) dnsCache.set(host, await assertPublicUrl(url)); return route.continue(); }
    catch { return route.abort("blockedbyclient"); }
  });
  const rootUrl = new URL(root); const firstSegment = rootUrl.pathname.split("/").filter(Boolean)[0];
  const prefixes = firstSegment && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(firstSegment) ? ["", `/${firstSegment}`] : [""];
  const conventional = prefixes.flatMap((prefix) => ["partners","sponsors","our-partners"].map((name) => `${origin}${prefix}/${name}`));
  const queue = [root, ...conventional.map((u) => normalizeUrl(u))], seen = new Set(), finalSeen = new Set();
  try {
    while (queue.length && seen.size < options.maxPages) {
      const requested = queue.shift(); if (seen.has(requested) || !robots.isAllowed(requested)) continue; seen.add(requested);
      const page = await context.newPage();
      try {
        const response = await page.goto(requested, {waitUntil:"domcontentloaded",timeout:45_000});
        await page.waitForTimeout(1200);
        for (let i=0;i<5;i++) { await page.evaluate((step) => scrollTo(0, document.body.scrollHeight * step/5), i+1); await page.waitForTimeout(280); }
        await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(700);
        const out = await extractPage(page); const finalUrl = normalizeUrl(page.url()); if (finalSeen.has(finalUrl)) continue; finalSeen.add(finalUrl); const status = response?.status() || 0; pages.push({url:finalUrl,title:out.title,status});
        if (status < 200 || status >= 400) warnings.push(`${finalUrl}: page returned HTTP ${status}.`);
        candidates.push(...out.candidates); warnings.push(...out.warnings.map((w) => `${finalUrl}: ${w}`));
        for (const link of out.links.sort((a,b) => b.priority-a.priority)) {
          try { const next = normalizeUrl(link.url, finalUrl); if (new URL(next).origin === origin && !seen.has(next) && robots.isAllowed(next)) queue.push(next); } catch {}
        }
      } catch (e) { pages.push({url:requested,title:"",status:0,error:e.message}); warnings.push(`${requested}: ${e.message}`); }
      finally { await page.close(); }
      if (robots.crawlDelayMs) await new Promise((r) => setTimeout(r, Math.min(robots.crawlDelayMs, 5000)));
    }
  } finally { await browser.close(); }
  const normalized = [];
  for (let i=0;i<candidates.length;i++) {
    const c = candidates[i];
    try { normalized.push({...c, logo: await normalizeLogo(c, outputDir, i+1)}); }
    catch (e) { warnings.push(`${c.sourcePage}: could not save ${c.name}: ${e.message}`); }
  }
  const uniqueWarnings = [...new Set(warnings)];
  const reviewed = await applyOverrides(normalized, options.overrides);
  const brands = mergeCandidates(reviewed);
  const reportWarnings = brands.some((b) => b.reviewRequired) ? uniqueWarnings : uniqueWarnings.filter((w) => !w.includes("Some names were inferred"));
  const manifest = { schemaVersion:"1.0", sourceUrl:root, startedAt, finishedAt:new Date().toISOString(), options:{maxPages:options.maxPages,respectRobots:options.respectRobots,overrides:options.overrides || null}, coverage:{status:queue.length ? "bounded" : reportWarnings.some((w) => /could not|error|timeout|blocked/i.test(w)) ? "partial" : "bounded",pagesVisited:pages.length,pagesDiscovered:seen.size+queue.length,limitReached:seen.size>=options.maxPages&&queue.length>0,warnings:reportWarnings}, pages, brands };
  const files = await exportReport(manifest, outputDir, {pptx:options.pptx,zip:options.zip});
  return { manifest, outputDir, files };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const options = parseArgs(process.argv.slice(2)); if (options.help || !options.url) { console.log(usage()); process.exit(options.help ? 0 : 1); }
    const result = await run(options); console.log(`Found ${result.manifest.brands.length} brand records across ${result.manifest.coverage.pagesVisited} pages.`); console.log(`Report: ${path.join(result.outputDir,"index.html")}`);
  } catch (e) { console.error(`Brand Atlas failed: ${e.message}`); process.exit(1); }
}
