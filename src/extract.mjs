const CONTEXT = /\b(partners?|partnerships?|sponsors?|sponsored by|supported by|powered by|presented by|official supplier|technical partner|apparel partner|organisers?|organizers?|federation|associations?|clients?|supporters?|commercial|marketing|mitra|kemitraan|sponsor utama|sponsor resmi|partner resmi|didukung|dipersembahkan)\b/i;
const EXCLUDE = /\b(header|qr(?:\s*code)?|icon|arrow|caret|chevron|search|menu|close|play|ticket|watch|facebook|instagram|youtube|linkedin|tiktok|twitter|x-logo|avatar|thumbnail|flag|frame|placeholder|spacer|globalwording|webname)\b/i;
const PLATFORM_HOST = /(?:^|\.)(?:doubleclick\.net|googlesyndication\.com|bit\.ly|t\.co|hostingersite\.com|wixsite\.com|wixstatic\.com|cloudfront\.net|googleusercontent\.com|amazonaws\.com|azureedge\.net|wordpress\.com)$/i;

export function cleanName(value = "", preserveColors = false) {
  return String(value || "").replace(/^Image:\s*/i, "").replace(/\.(svg|png|jpe?g|webp|gif|avif)(\?.*)?$/i, "")
    .replace(/[_-]+/g, " ").replace(/\b(on (?:a )?(?:dark|light|white|black) background|dark bg|light bg|logo versions?|logos?|partners?|sponsors?|desktop|mobile|svg|png|jpe?g|webp|gif|avif)\b/gi, " ")
    .replace(preserveColors ? /$^/g : /\b(white|black|dark|light|colour|color)\b/gi, " ")
    .replace(/[,\s]*(?:more information \(opens dialog box\)|\(to the website\)|website[.]?)\s*$/i, "")
    .replace(/\s+/g, " ").replace(/[. ]+$/, "").trim();
}

export function inferName(meta) {
  const values = [meta.alt, meta.aria, meta.title, meta.linkText].map(v=>cleanName(v,true)).filter(Boolean);
  const generic = /^(?:global sprite|sprite sheet|sprite|name|our|event title|put your brand on the global stage|undefined|null|image(?: \d+)?|sss|official|umpire|strategic timeout|good times|broadcast|official digital streaming|global|principal|premium|title|tour|supplier|supporter|sponsors? & partners?)$/i;
  const explicit = values.find(v => v.length > 1 && v.length <= 100 && /[\p{L}\d]/u.test(v) && !EXCLUDE.test(v) && !generic.test(v) && !/^[{[]/.test(v) && !/\b(?:matchday|goal of the day|player of the week|this week|ceremony|all you need to know)\b/i.test(v) && !/^(.)\1{2,}$/.test(v));
  if (explicit) return { name: explicit, nameSource: "page metadata", confidence: 0.92, reviewRequired: false };
  const prose = ((meta.alt || "").length > 100 ? meta.alt : meta.description || "").replace(/\s+/g, " ").trim();
  const intro = prose.match(/^((?:The\s+)?[A-Z0-9][A-Za-z0-9&.’'-]+(?:\s+(?:[A-Z0-9][A-Za-z0-9&.’'-]+|Foundation|Federation|Airways)){0,5})\s+(?:proudly\s+supports?|supports?|stands?|collaborates?|leads?|provides?|partners?|helps?|is|has)\b/);
  if (intro) return { name: intro[1].replace(/^The\s+/, ""), nameSource: "nearby website description", confidence: 0.88, reviewRequired: false };
  const announced = prose.match(/\bannounces?\s+([A-Z][A-Za-z0-9&.’'-]+(?:\s+[A-Z][A-Za-z0-9&.’'-]+){0,3})\s+as\b/i);
  if (announced) return { name: announced[1], nameSource: "nearby website description", confidence: 0.84, reviewRequired: false };
  if (meta.href) {
    try {
      const host = new URL(meta.href).hostname.replace(/^www\./, "");
      const base = host.split(".")[0];
      const pageHost = meta.pageUrl ? new URL(meta.pageUrl).hostname.replace(/^www\./, "") : "";
      if (host !== pageHost && !PLATFORM_HOST.test(host) && base && !/invalid|localhost/i.test(base)) return { name: cleanName(base).replace(/\b\w/g, (c) => c.toUpperCase()), nameSource: "linked domain", confidence: 0.72, reviewRequired: true };
    } catch {}
  }
  try {
    let asset = new URL(meta.src);
    const proxied = asset.searchParams.get('url') || asset.searchParams.get('src');
    if (proxied && /^https?:/.test(proxied)) asset = new URL(proxied);
    const pathname = decodeURIComponent(asset.pathname);
    const filename = pathname.split("/").pop() || "";
    const inferred = cleanName(filename).replace(/^\d+\s*/, "");
    if (inferred && !/^[a-f0-9\s]{16,}$/i.test(inferred) && !/^[a-f0-9]{8} [a-f0-9]{4} [a-f0-9]{4}/i.test(inferred) && !EXCLUDE.test(inferred) && !generic.test(inferred) && inferred.length <= 100) return { name: inferred.replace(/\b\w/g, (c) => c.toUpperCase()), nameSource: "asset filename", confidence: 0.58, reviewRequired: true };
  } catch {}
  return { name: "Unknown logo", nameSource: "unavailable", confidence: 0.25, reviewRequired: true };
}

export async function extractPage(page) {
  const raw = await page.evaluate(() => {
    // Commercial evidence only: a federation name or generic footer is not a sponsor list.
    const cue = /(?:^|[^a-z])(?:partners?|partnerships?|sponsors?|suppliers?|supporters?|mitra|partenaires|patrocinadores|patrocinador|sponsoren)(?=$|[^a-z])|sponsored by|supported by|powered by|presented by|didukung|dipersembahkan/i;
    const sectionCue = /^(?:[\p{L}\d&/+.’-]+\s+){0,7}(?:partners?|sponsors?|suppliers?|supporters?|mitra|partenaires|patrocinadores|patrocinador|sponsoren)(?:\s+\d{4}(?:\s*[/–-]\s*\d{2,4})?)?$|^(?:(?:sponsored|supported|powered|presented)\s+by|didukung|dipersembahkan|スポンサー|合作伙伴|赞助商)$/iu;
    const isLabel = text => text.length <= 100 && !/\b(?:become|be a|be our|join|announce|announces|news|contact|find out|read more)\b/i.test(text) && sectionCue.test(text);
    const parentOf = node => node?.parentElement || node?.getRootNode?.()?.host || null;
    const contains = (ancestor, child) => { for(let node=child;node;node=parentOf(node)) if(node===ancestor)return true; return false; };
    const closest = (el,selector) => { for(let node=el;node;node=parentOf(node)) if(node.matches?.(selector))return node; return null; };
    const exclude = /\b(header|qr(?:\s*code)?|icon|arrow|caret|chevron|search|menu|close|play|ticket|watch|facebook|instagram|youtube|linkedin|tiktok|twitter|avatar|thumbnail|flag|frame|placeholder|spacer)\b/i;
    const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) !== 0 && r.width >= 12 && r.height >= 8; };
    const directText = (el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent || "").join(" ").replace(/\s+/g, " ").trim();
    const allElements = [];
    const visit = root => { for(const el of root.children || []) {allElements.push(el);if(el.shadowRoot)visit(el.shadowRoot);visit(el);} };
    if(document.body)visit(document.body);
    const documentOrder = new Map(allElements.map((el, index) => [el, index]));
    const sectionLabels = allElements.filter((el) => {
      const text = directText(el) || (/^H[1-6]$/.test(el.tagName) || el.getAttribute?.("role") === "heading" ? (el.textContent || "").trim() : "");
      return text.length > 0 && isLabel(text);
    });
    const markerFor = (node) => `${node.id || ""} ${typeof node.className === "string" ? node.className : ""} ${node.getAttribute?.("aria-label") || ""}`.replace(/([a-z])([A-Z])/g, '$1 $2');
    const markerCue = marker => cue.test(marker.replace(/([a-z])([A-Z])/g, '$1 $2')) || /(?:sponsor|partner)(?:bar|logo|strip|list|grid|carousel)/i.test(marker);
    const blockedRegion = 'header,nav,[role="navigation"],[role="banner"],[role="dialog"],[class*="footer__bottom"],[class*="footer-bottom"],[class~="navbar"],[class^="navbar-"],[class*=" navbar-"],form[class*="newsletter"],[class~="newsletter"]';
    const partnerScope = (el) => {
      if (closest(el,blockedRegion)) return null;
      const article=closest(el,'article');
      const directoryPage=/(?:^|\/)(?:our-|official-|global-)?(?:partners|sponsors)(?:\/|$|\.)/i.test(location.pathname);
      if(article && !markerCue(markerFor(article)) && !directoryPage)return null;
      for (let node = el, depth = 0; node && depth < 11; node = parentOf(node), depth++) {
        if ([document.body, document.documentElement].includes(node)) break;
        const marker = markerFor(node);
        const footerRoot = node.matches('footer,[role="contentinfo"]');
        // Never spread a descendant's class (e.g. partners-link) to its siblings.
        if (!footerRoot && (markerCue(`${node.id || ""} ${typeof node.className === "string" ? node.className : ""}`.replace(/([a-z])([A-Z])/g, '$1 $2')) || isLabel(node.getAttribute("aria-label") || ""))) {
          const label = sectionLabels.filter((label) => contains(node,label) && !closest(label,blockedRegion) && documentOrder.get(label) < documentOrder.get(el)).at(-1);
          return { node, heading: label ? (directText(label) || label.textContent || '').trim() : (marker.match(cue)?.[0] || node.getAttribute('aria-label') || 'Partners').replace(/^[^a-z]+/i, '').trim() };
        }
        const labels = sectionLabels.filter((label) => contains(node,label) &&
          !closest(label,blockedRegion) && documentOrder.get(label) < documentOrder.get(el));
        for (const label of labels.reverse()) {
          // A heading owns the following list only until the next unrelated heading.
          const intervening = allElements.some((other) => contains(node,other) &&
            (/^H[1-6]$/.test(other.tagName) || other.getAttribute('role') === 'heading') &&
            documentOrder.get(other) > documentOrder.get(label) &&
            documentOrder.get(other) < documentOrder.get(el) && !contains(label,other) &&
            !sectionLabels.includes(other));
          if (intervening) continue;
          let branch = el;
          while (branch.parentElement && branch.parentElement !== node) branch = branch.parentElement;
          let labelBranch = label;
          while (labelBranch.parentElement && labelBranch.parentElement !== node) labelBranch = labelBranch.parentElement;
          if (labelBranch !== branch) {
            let sibling = labelBranch.nextElementSibling;
            while (sibling && sibling !== branch && sibling.matches('a,img,svg,object')) sibling = sibling.nextElementSibling;
            if (sibling !== branch) continue;
          }
          // On broad wrappers/footer roots, only list-like branches qualify.
          if ((footerRoot || node.matches('main,[role="main"]')) &&
              !branch.matches('ul,ol,section,[role="list"]') && !markerCue(markerFor(branch))) continue;
          if (node.querySelectorAll('img,svg,object').length > 160) continue;
          return { node, heading: (directText(label) || label.textContent || '').trim() };
        }
        if (footerRoot) break;
      }
      return null;
    };
    const contextFor = (el) => {
      let n = el; const parts = [];
      for (let depth = 0; n && depth < 9; depth++, n = parentOf(n)) parts.push(`${n.id || ""} ${n.className || ""}`);
      return parts.join(" ");
    };
    const items = [];
    const add = (el, src, kind, inlineSvg = "", crop = undefined) => {
      const anchor = closest(el,"a[href]"); const context = contextFor(el); const alt = el.getAttribute("alt") || ""; const directoryPage=/(?:^|\/)(?:our-|official-|global-)?(?:partners|sponsors)(?:\/|$|\.)/i.test(location.pathname);
      const scope = partnerScope(el) || (directoryPage && !closest(el,blockedRegion) && closest(el,'main,article') && /logo|\/(?:sponsors?|partners?)\//i.test(`${alt} ${src}`) ? {node:el,heading:'Partner directory'} : null); const footer = closest(el,"footer");
      // A link back to this site's home page identifies its own brand, not a sponsor.
      let ownerLink = false;
      try {
        const target = new URL(anchor?.href || "");
        ownerLink = target.hostname.replace(/^www\./, '') === location.hostname.replace(/^www\./, '') &&
          /^\/(?:[a-z]{2}\/?)?(?:home(?:-page)?\/?)?$/i.test(target.pathname);
      } catch {}
      let decorative = false;
      for (let node = el; node; node = parentOf(node)) {
        if (/(?:^|[\s_-])(?:hero|banner|image-callout|news|article|teaser|thumbnail|video)(?=$|[\s_-])/i.test(typeof node.className === "string" ? node.className : "")) decorative = true;
        if (node === scope?.node) break;
      }
      const relevant = Boolean(scope) && !ownerLink && !decorative;
      if(closest(el,'pk-card,.article--img-wrap,.pflazyload-wrapper') && !/logo|\/sponsors?\//i.test(src))return;
      if(['background','css-sprite'].includes(kind) && (el.querySelector('img,svg,object,h1,h2,h3') || el.getBoundingClientRect().height>350)) return;
      if(kind==='inline-svg' && (el.querySelector('use')?.getAttribute('href') || '').startsWith('#')) {
        const clone=el.cloneNode(true);
        for(const use of clone.querySelectorAll('use')) {
          const id=(use.getAttribute('href')||use.getAttribute('xlink:href')||'').slice(1);
          const symbol=el.getRootNode().getElementById?.(id) || document.getElementById(id);
          if(symbol) {const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.innerHTML=symbol.innerHTML;use.replaceWith(g);}
        }
        inlineSvg=new XMLSerializer().serializeToString(clone);
      }
      if(kind==='inline-svg' && (closest(el,'button,[role="button"]') || (!alt && !el.querySelector('title') && el.getBoundingClientRect().width<=32)))return;
      const storedAsset = Boolean(src || inlineSvg);
      if (!relevant || exclude.test(`${alt} ${src}`) || (!visible(el) && !(scope && storedAsset))) return;
      let description = ""; let parent = el.parentElement;
      for (let depth=0; parent && depth<6; depth++, parent=parentOf(parent)) {
        const value=(parent.innerText||"").replace(/\s+/g," ").trim();
        if (value.length>=25 && value.length<=1600) { description=value; break; }
      }
      items.push({ src, kind, inlineSvg, crop, alt, aria: el.getAttribute("aria-label") || anchor?.getAttribute("aria-label") || anchor?.getAttribute("data-sponsor-title") || "", title: el.getAttribute("title") || "", href: anchor?.href || "", linkText: anchor?.textContent?.trim().slice(0,160) || "", description, section: scope?.heading || (footer ? "Footer" : "Brand mark"), context: context.slice(0,500), selector: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).slice(0,2).join(".")}` : ""}` });
    };
    const srcsetUrl = (value = "") => value.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean).pop() || "";
    const imageSource = img => {
      const current = img.currentSrc || img.getAttribute('src') || '';
      const deferred = ['data-src','data-lazy-src','data-original','data-lazy','data-lazyload','data-url'].map(a=>img.getAttribute(a)).find(Boolean) || srcsetUrl(img.getAttribute('data-srcset') || '') || srcsetUrl(img.getAttribute('srcset') || '') || srcsetUrl(img.closest('picture')?.querySelector('source')?.getAttribute('srcset') || '');
      const placeholder = !current || /^(?:data:image\/(?:gif|svg)|about:blank)/i.test(current) || /(?:placeholder|transparent|spacer|blank)[_.-]/i.test(current);
      if(!current&&!deferred)return '';
      try { return new URL(placeholder && deferred ? deferred : current || deferred, location.href).href; }catch{return '';}
    };
    for (const img of allElements.filter(el=>el.tagName==="IMG")) { const src = imageSource(img); add(img, src, src.startsWith("data:image/") ? "data-image" : "image"); }
    for (const svg of allElements.filter(el=>el.tagName?.toLowerCase()==="svg")) add(svg, location.href, "inline-svg", new XMLSerializer().serializeToString(svg));
    for (const object of allElements.filter(el=>el.matches('object[type^="image/"],object[data$=".svg"]'))) add(object, object.data || object.getAttribute("data") || "", "image");
    for (const el of allElements) {
      const bg = getComputedStyle(el).backgroundImage || "";
      for (const match of bg.matchAll(/url\(["']?(.*?)["']?\)/g)) {
        const style=getComputedStyle(el),rect=el.getBoundingClientRect();
        const crop=style.backgroundPosition!=='0% 0%' || style.backgroundSize!=='auto' ? {position:style.backgroundPosition,size:style.backgroundSize,width:Math.round(rect.width),height:Math.round(rect.height)} : undefined;
        add(el,new URL(match[1],location.href).href,crop?'css-sprite':'background','',crop);
      }
    }
    const links = allElements.filter(el=>el.matches("a[href]")).map((a) => ({ url: a.href, text: (a.textContent || a.getAttribute("aria-label") || "").trim().slice(0,180), context: contextFor(a).slice(0,300) })).filter((x) => cue.test(`${x.text} ${x.url}`) && !/\/(?:news|videos?|articles?|press-releases?|cookies?|privacy|terms|advertise-or-partner-with-us)(?:\/|$|\?)/i.test(x.url));
    const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1200);
    return { title: document.title, url: location.href, items, links, bodyText, partnerLabels: sectionLabels.map((el) => (directText(el) || el.textContent || "").trim()).filter(Boolean), appError: /application error|client-side exception|chunkloaderror/i.test(bodyText) ? bodyText : "" };
  });
  const seen = new Set();
  const candidates = raw.items.filter(item => {const key=`${item.kind}|${item.src}|${item.inlineSvg || ""}|${JSON.stringify(item.crop || {})}`;if(seen.has(key))return false;seen.add(key);return true;}).filter((x) => x.src || x.inlineSvg).map((item) => {
    const named = inferName({...item, siteTitle: raw.title, pageUrl: raw.url});
    const evidenceText = `${item.section} ${item.alt} ${item.context}`;
    const relationship = /supplier/i.test(item.section) ? "Supplier" : /sponsor|sponsored|patrocin|スポンサー|赞助/i.test(item.section) ? "Sponsor" : "Partner";
    return { ...named, relationship, section: item.section, evidence: [item.alt, item.linkText, item.section].filter(Boolean).join(" | "), sourcePage: raw.url, sourceUrl: item.src, brandUrl: item.href, kind: item.kind, crop: item.crop, selector: item.selector, inlineSvg: item.inlineSvg || undefined };
  }).filter((item) => !EXCLUDE.test(item.name));
  const warnings = [];
  if (candidates.some((c) => c.reviewRequired)) warnings.push("Some names were inferred from domains or filenames and require review.");
  if (raw.appError) warnings.push(`The rendered page reported a client-side application error: ${raw.appError.slice(0, 260)}`);
  if (raw.partnerLabels.length && !candidates.length) warnings.push(`Partner or sponsor labels were present (${[...new Set(raw.partnerLabels)].slice(0, 4).join(", ")}), but the page exposed no downloadable logo assets.`);
  return { title: raw.title, text: raw.bodyText || raw.appError || "", links: raw.links.map(({url,text}) => ({ url, text, priority: CONTEXT.test(text) ? 2 : 1 })), candidates, warnings };
}
