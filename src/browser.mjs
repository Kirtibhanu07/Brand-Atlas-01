import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { assertPublicUrl, normalizeUrl, parseRobots, safeFetch } from './network.mjs';
import { extractPage } from './extract.mjs';
import { classifyFailure, retry, sleep, TRANSIENT_STATUS } from './resilience.mjs';

export async function launchBrowser(headed = false) {
  const args = ['--disable-dev-shm-usage'];
  if (process.env.CHROMIUM_PATH) return chromium.launch({headless:!headed,executablePath:process.env.CHROMIUM_PATH,args});
  try { return await chromium.launch({headless:!headed,args}); }
  catch (first) {
    for (const executablePath of ['/usr/bin/chromium','/usr/bin/chromium-browser','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
      try { await fs.access(executablePath); return await chromium.launch({headless:!headed,executablePath,args}); } catch {}
    }
    throw new Error(`Chromium is unavailable. Install the Playwright browser or set CHROMIUM_PATH. ${first.message}`);
  }
}

export const sameSite = (a,b) => new URL(a).hostname.replace(/^www\./i,'') === new URL(b).hostname.replace(/^www\./i,'');
const allowAll = {isAllowed:()=>true,crawlDelayMs:0,sitemaps:[]};

export function robotsCache({fetcher = safeFetch, respectRobots = true, timeoutMs = 6000} = {}) {
  const cache = new Map();
  return async value => {
    if (!respectRobots) return allowAll;
    const origin = new URL(value).origin;
    if (!cache.has(origin)) cache.set(origin, (async () => {
      try {
        const res = await fetcher(`${origin}/robots.txt`, {maxBytes:500_000,timeoutMs});
        if (res.status === 200) return parseRobots(res.body.toString('utf8'));
        if (res.status === 404 || res.status === 410) return allowAll;
        return {...allowAll,isAllowed:()=>false,unavailable:`robots.txt returned HTTP ${res.status}`};
      } catch (error) { return {...allowAll,isAllowed:()=>false,unavailable:`robots.txt unavailable: ${error.message}`}; }
    })());
    return cache.get(origin);
  };
}

export async function createScanContext(browser, {respectRobots = true, timeoutMs = 25_000} = {}) {
  const context = await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',locale:'en-US',colorScheme:'light'});
  context.setDefaultTimeout(timeoutMs);
  const policyFor = robotsCache({respectRobots,timeoutMs:Math.min(timeoutMs,6000)});
  const dnsCache = new Map();
  await context.route('**/*', async route => {
    const request = route.request(), value = request.url();
    try {
      if (/^(data|blob|about):/.test(value)) return await route.continue();
      // Validate protocol, credentials and port on every request, including redirects.
      const normalized = normalizeUrl(value), host = new URL(normalized).hostname;
      if (!dnsCache.has(host)) dnsCache.set(host, assertPublicUrl(normalized));
      await dnsCache.get(host);
      if (request.isNavigationRequest()) {
        const policy = await policyFor(normalized);
        if (!policy.isAllowed(normalized)) return await route.abort('blockedbyclient');
      }
      if (['media','font'].includes(request.resourceType())) return await route.abort('blockedbyclient');
      return await route.continue();
    } catch { await route.abort('blockedbyclient').catch(()=>{}); }
  });
  return {context,policyFor};
}

export function pageOutcome({status = 0, title = '', text = '', candidates = [], error} = {}) {
  if (error) return classifyFailure(error);
  if ([401,403].includes(status) || /just a moment|access denied|verify (?:that )?you are human|captcha|attention required/i.test(`${title} ${text.slice(0,500)}`)) return 'blocked';
  if (/domain (?:is )?for sale|buy this domain|website is for sale/i.test(`${title} ${text.slice(0,1000)}`)) return 'parked_domain';
  if (status === 429) return 'rate_limited';
  if (status >= 400) return 'http_error';
  if (/application error|client-side exception|chunkloaderror/i.test(text)) return 'application_error';
  return candidates.length ? 'found' : 'no_evidence';
}

export async function dismissConsent(page) {
  // Only reject optional cookies. Do not click arbitrary overlays or accept legal terms.
  for(const selector of ['#onetrust-reject-all-handler','button[aria-label="Reject all cookies"]']) {
    const button=page.locator(selector).first();
    try {if(await button.isVisible()) {await button.click({timeout:1000});return true;}}catch{}
  }
  return false;
}

export async function renderPage(page, url, {timeoutMs = 25_000, deadline = Date.now()+60_000} = {}) {
  let status = 0;
  const remaining = () => Math.max(1, Math.min(timeoutMs, deadline-Date.now()));
  await retry(async () => {
    const response = await page.goto(url,{waitUntil:'domcontentloaded',timeout:remaining()});
    status = response?.status() || 0;
    if (TRANSIENT_STATUS.has(status) && status !== 429) throw new Error(`Temporary HTTP ${status}`);
  }, {attempts:2,shouldRetry:error=>Date.now()<deadline && !['unsafe_url','tls_error','redirect_error'].includes(classifyFailure(error))});
  if (status >= 400) return {status, title:await page.title(), candidates:[],links:[],warnings:[`Page returned HTTP ${status}`]};
  await page.waitForTimeout(Math.min(1000,remaining()));
  await dismissConsent(page);
  await page.waitForLoadState('networkidle',{timeout:Math.min(2000,remaining())}).catch(()=>{});
  // Scroll the real scroll container as well as the document; lazy assets need not be visible at the end.
  for (let step=1; step<=6 && Date.now()<deadline; step++) {
    await page.evaluate(step => {
      window.scrollTo(0,document.documentElement.scrollHeight*step/6);
      for (const node of document.querySelectorAll('main,[role="main"],.scroll-container')) {
        if (node.scrollHeight>node.clientHeight+100) node.scrollTop=node.scrollHeight*step/6;
      }
    },step);
    await page.waitForTimeout(200);
  }
  const out = await extractPage(page);
  // Loaded same-site embedded sponsor sections. Unrelated third-party frames never become evidence.
  for (const frame of page.frames().filter(frame=>frame!==page.mainFrame()).slice(0,6)) {
    try {
      if (!sameSite(frame.url(),page.url())) continue;
      const embedded = await extractPage(frame);
      out.candidates.push(...embedded.candidates);
      out.links.push(...embedded.links);
      out.warnings.push(...embedded.warnings);
    } catch { out.warnings.push('An embedded section could not be inspected.'); }
  }
  return {status,...out};
}

export async function crawlSite(browser, root, {maxPages=8, timeoutMs=25_000, siteTimeoutMs=120_000, respectRobots=true, partnerUrls=[]} = {}) {
  await assertPublicUrl(root);
  const {context,policyFor} = await createScanContext(browser,{respectRobots,timeoutMs});
  const deadline=Date.now()+siteTimeoutMs, pages=[], candidates=[], warnings=[];
  const queue=[root,...partnerUrls.filter(url=>sameSite(url,root))],seen=new Set(),finalSeen=new Set();
  // Closing the context interrupts stalled navigation/evaluation instead of leaving orphaned work.
  const timer=setTimeout(()=>context.close().catch(()=>{}),siteTimeoutMs);
  let guessesAdded=false;
  try {
    while (queue.length && pages.length<maxPages && Date.now()<deadline) {
      const requested=normalizeUrl(queue.shift());
      if(seen.has(requested))continue;seen.add(requested);
      const policy=await policyFor(requested);
      if(!policy.isAllowed(requested)) {
        pages.push({url:requested,status:0,outcome:policy.unavailable?'robots_unavailable':'robots_disallowed',error:policy.unavailable||'robots.txt disallows this page'});
        continue;
      }
      if(policy.crawlDelayMs) {
        if(Date.now()+policy.crawlDelayMs>deadline){warnings.push('Crawl delay exceeds the remaining time budget.');break;}
        await sleep(policy.crawlDelayMs);
      }
      let page;
      try {
        page=await context.newPage();
        const out=await renderPage(page,requested,{timeoutMs,deadline});
        const finalUrl=normalizeUrl(page.url());
        if(finalSeen.has(finalUrl))continue;finalSeen.add(finalUrl);
        const outcome=pageOutcome({...out,text:out.text || out.warnings.join(' ')});
        pages.push({url:finalUrl,requestedUrl:requested,title:out.title,status:out.status,outcome,candidateCount:out.candidates.length});
        if(outcome==='found'||outcome==='no_evidence') {
          candidates.push(...out.candidates);
          const discovered=out.links.sort((a,b)=>b.priority-a.priority).flatMap(link=>{
            try {const url=normalizeUrl(link.url,finalUrl);return (sameSite(url,root)||sameSite(url,finalUrl))&&!seen.has(url)&&!/\.(?:pdf|zip|jpe?g|png|svg)(?:\?|$)/i.test(url)?[url]:[];}catch{return[];}
          });
          queue.unshift(...[...new Set(discovered)].slice(0,20));
        }
        warnings.push(...out.warnings.map(w=>`${finalUrl}: ${w}`));
        // Blocks do not become a cascade of guessed requests to the same site.
        if(['blocked','rate_limited'].includes(outcome))break;
        if(!queue.length && !guessesAdded && !candidates.length && out.status<400) {
          guessesAdded=true;
          const u=new URL(finalUrl),lang=u.pathname.match(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/i)?.[0]||'';
          queue.push(...['partners','sponsors','our-partners'].map(p=>`${u.origin}${lang}/${p}`));
        }
      } catch(error) {pages.push({url:requested,status:0,outcome:classifyFailure(error),error:error.message});}
      finally{await page?.close().catch(()=>{});}
    }
  } finally {clearTimeout(timer);await context.close().catch(()=>{});}
  const limitReached=queue.length>0&&(pages.length>=maxPages||Date.now()>=deadline);
  if(Date.now()>=deadline)warnings.push('The site time budget was reached; saved evidence is preserved.');
  return {pages,candidates,warnings:[...new Set(warnings)],limitReached,pagesDiscovered:seen.size+queue.length};
}
