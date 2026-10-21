// Optional live smoke check. No fixed sponsor counts: websites change over time.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { extractPage } from '../src/extract.mjs';
import { assertPublicUrl, parseRobots, safeFetch } from '../src/network.mjs';

const sites = JSON.parse(await fs.readFile(new URL('../examples/sports-sites.json', import.meta.url)));
const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
const results = [];
try {
  for (const site of sites) {
    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    await context.route('**/*', async route => {
      if (/^(data|blob|about):/.test(route.request().url())) return route.continue();
      try { await assertPublicUrl(route.request().url()); await route.continue(); }
      catch { await route.abort(); }
    });
    const page = await context.newPage();
    try {
      await assertPublicUrl(site.url);
      const robots = await safeFetch(`${new URL(site.url).origin}/robots.txt`, {maxBytes:500_000});
      if (robots.status === 200 && !parseRobots(robots.body.toString()).isAllowed(site.url)) {
        results.push({...site, limitation:'robots.txt disallows this page'});
        continue;
      }
      const response = await page.goto(site.url, {waitUntil:'domcontentloaded',timeout:30_000});
      for (let step=1; step<=5; step++) {
        await page.evaluate(step => scrollTo(0, document.body.scrollHeight * step / 5), step);
        await page.waitForTimeout(600);
      }
      const out = await extractPage(page);
      results.push({...site,status:response?.status(),title:out.title,
        candidates:out.candidates.map(({name,section,sourceUrl}) => ({name,section,sourceUrl})),warnings:out.warnings});
    } catch (error) { results.push({...site, limitation:error.message}); }
    finally { await context.close(); }
    console.log(JSON.stringify(results.at(-1)));
  }
} finally { await browser.close(); }
await fs.mkdir('output', {recursive:true});
await fs.writeFile('output/sports-check.json', JSON.stringify(results,null,2));
