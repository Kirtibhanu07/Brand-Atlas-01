const CONTEXT = /\b(partners?|partnerships?|sponsors?|sponsored by|supported by|powered by|presented by|official supplier|technical partner|apparel partner|organisers?|organizers?|federation|associations?|clients?|supporters?|commercial|marketing|mitra|kemitraan|sponsor utama|sponsor resmi|partner resmi|didukung|dipersembahkan)\b/i;
const EXCLUDE = /\b(header|qr(?:\s*code)?|icon|arrow|caret|chevron|search|menu|close|play|ticket|watch|facebook|instagram|youtube|linkedin|tiktok|twitter|x-logo|avatar|thumbnail|flag|frame|placeholder|spacer|globalwording|webname)\b/i;
const PLATFORM_HOST = /(?:^|\.)(?:hostingersite\.com|wixsite\.com|wixstatic\.com|cloudfront\.net|googleusercontent\.com|amazonaws\.com|azureedge\.net|wordpress\.com)$/i;

export function cleanName(value = "") {
  return value.replace(/\.(svg|png|jpe?g|webp|gif|avif)(\?.*)?$/i, "")
    .replace(/[_-]+/g, " ").replace(/\b(logo|partner|sponsor|white|black|colour|color|desktop|mobile|new|svg|png|jpe?g|webp|gif|avif)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
}

export function inferName(meta) {
  const values = [meta.alt, meta.aria, meta.title, meta.linkText].map(cleanName).filter(Boolean);
  const explicit = values.find((v) => v.length > 1 && /[A-Za-z0-9À-ž]/.test(v) && !EXCLUDE.test(v));
  if (explicit) return { name: explicit, nameSource: "page metadata", confidence: 0.92, reviewRequired: false };
  const prose = (meta.description || "").replace(/\s+/g, " ").trim();
  const intro = prose.match(/^((?:The\s+)?[A-Z][A-Za-z&.’'-]+(?:\s+(?:[A-Z][A-Za-z&.’'-]+|Foundation|Federation|Airways)){0,5})\s+(?:proudly\s+supports?|supports?|stands?|collaborates?|leads?|provides?|partners?|helps?|is|has)\b/);
  if (intro) return { name: intro[1].replace(/^The\s+/, ""), nameSource: "nearby website description", confidence: 0.88, reviewRequired: false };
  const announced = prose.match(/\bannounces?\s+([A-Z][A-Za-z0-9&.’'-]+(?:\s+[A-Z][A-Za-z0-9&.’'-]+){0,3})\s+as\b/i);
  if (announced) return { name: announced[1], nameSource: "nearby website description", confidence: 0.84, reviewRequired: false };
  if (/partner\s+logo/i.test(meta.alt || "") && meta.href && meta.siteTitle) {
    try {
      if (new URL(meta.href).origin === new URL(meta.src).origin) {
        const owner = meta.siteTitle.split(/\s+[|–—-]\s+/)[0].trim();
        if (owner) return { name: owner, nameSource: "website title", confidence: 0.78, reviewRequired: true };
      }
    } catch {}
  }
  if (meta.href) {
    try {
      const host = new URL(meta.href).hostname.replace(/^www\./, "");
      const base = host.split(".")[0];
      const pageHost = meta.pageUrl ? new URL(meta.pageUrl).hostname.replace(/^www\./, "") : "";
      if (host !== pageHost && !PLATFORM_HOST.test(host) && base && !/invalid|localhost/i.test(base)) return { name: cleanName(base).replace(/\b\w/g, (c) => c.toUpperCase()), nameSource: "linked domain", confidence: 0.72, reviewRequired: true };
    } catch {}
  }
  try {
    const pathname = new URL(meta.src).pathname;
    const filename = pathname.split("/").pop() || "";
    const inferred = cleanName(filename).replace(/^\d+\s*/, "");
    if (inferred && !/^[a-f0-9]{16,}$/i.test(inferred) && !EXCLUDE.test(inferred)) return { name: inferred.replace(/\b\w/g, (c) => c.toUpperCase()), nameSource: "asset filename", confidence: 0.58, reviewRequired: true };
  } catch {}
  return { name: "Unknown logo", nameSource: "unavailable", confidence: 0.25, reviewRequired: true };
}

export async function extractPage(page) {
  const raw = await page.evaluate(() => {
    // Commercial evidence only: a federation name or generic footer is not a sponsor list.
    const cue = /(?:^|[^a-z])(?:partners?|partnerships?|sponsors?|suppliers?|supporters?|mitra)(?=$|[^a-z])|sponsored by|supported by|powered by|presented by|didukung|dipersembahkan/i;
    const sectionCue = /^(?:(?:our|tour|brand|corporate|official|main|supporting|technical|commercial|strategic|apparel|title|global|principal|premium|associate|community|event|broadcast|media|digital|equipment|automotive|banking|food|and|&|sponsors?|partners?)\s+)*(?:partners?|sponsors?|suppliers?|supporters?|mitra)(?:\s+\d{4}(?:\s*[/–-]\s*\d{2,4})?)?$|^(?:sponsored|supported|powered|presented)\s+by$|^(?:didukung|dipersembahkan)$/i;
    const exclude = /\b(header|qr(?:\s*code)?|icon|arrow|caret|chevron|search|menu|close|play|ticket|watch|facebook|instagram|youtube|linkedin|tiktok|twitter|avatar|thumbnail|flag|frame|placeholder|spacer)\b/i;
    const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) !== 0 && r.width >= 12 && r.height >= 8; };
    const directText = (el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent || "").join(" ").replace(/\s+/g, " ").trim();
    const allElements = [...document.querySelectorAll("body *")];
    const documentOrder = new Map(allElements.map((el, index) => [el, index]));
    const sectionLabels = allElements.filter((el) => {
      const text = directText(el) || (/^H[1-6]$/.test(el.tagName) || el.getAttribute?.("role") === "heading" ? (el.textContent || "").trim() : "");
      return text.length > 0 && text.length <= 100 && sectionCue.test(text);
    });
    const markerFor = (node) => `${node.id || ""} ${typeof node.className === "string" ? node.className : ""} ${node.getAttribute?.("aria-label") || ""}`;
    const blockedRegion = 'header,nav,[role="navigation"],[role="banner"],article,[role="dialog"],[class*="footer__bottom"],[class*="footer-bottom"],[class*="navbar"],[class*="newsletter"]';
    const partnerScope = (el) => {
      if (el.closest(blockedRegion)) return null;
      for (let node = el, depth = 0; node && depth < 11; node = node.parentElement, depth++) {
        if ([document.body, document.documentElement].includes(node)) break;
        const marker = markerFor(node);
        const footerRoot = node.matches('footer,[role="contentinfo"]');
        // Never spread a descendant's class (e.g. partners-link) to its siblings.
        if (!footerRoot && (cue.test(`${node.id || ""} ${typeof node.className === "string" ? node.className : ""}`) || sectionCue.test(node.getAttribute("aria-label") || ""))) {
          const label = sectionLabels.filter((label) => node.contains(label) && !label.closest(blockedRegion) && documentOrder.get(label) < documentOrder.get(el)).at(-1);
          return { node, heading: label ? (directText(label) || label.textContent || '').trim() : marker.match(cue)[0].replace(/^[^a-z]+/i, '').trim() };
        }
        const labels = sectionLabels.filter((label) => node.contains(label) &&
          !label.closest(blockedRegion) && documentOrder.get(label) < documentOrder.get(el));
        for (const label of labels.reverse()) {
          // A heading owns the following list only until the next unrelated heading.
          const intervening = allElements.some((other) => node.contains(other) &&
            (/^H[1-6]$/.test(other.tagName) || other.getAttribute('role') === 'heading') &&
            documentOrder.get(other) > documentOrder.get(label) &&
            documentOrder.get(other) < documentOrder.get(el) && !label.contains(other) &&
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
              !branch.matches('ul,ol,section,[role="list"]') && !cue.test(markerFor(branch))) continue;
          if (node.querySelectorAll('img,svg,object').length > 64) continue;
          return { node, heading: (directText(label) || label.textContent || '').trim() };
        }
        if (footerRoot) break;
      }
      return null;
    };
    const contextFor = (el) => {
      let n = el; const parts = [];
      for (let depth = 0; n && depth < 9; depth++, n = n.parentElement) parts.push(`${n.id || ""} ${n.className || ""}`);
      return parts.join(" ");
    };
    const items = [];
    const add = (el, src, kind, inlineSvg = "") => {
      const anchor = el.closest("a[href]"); const context = contextFor(el); const alt = el.getAttribute("alt") || ""; const scope = partnerScope(el); const footer = el.closest("footer");
      // A link back to this site's home page identifies its own brand, not a sponsor.
      let ownerLink = false;
      try {
        const target = new URL(anchor?.href || "");
        ownerLink = target.hostname.replace(/^www\./, '') === location.hostname.replace(/^www\./, '') &&
          /^\/(?:[a-z]{2}\/?)?(?:home(?:-page)?\/?)?$/i.test(target.pathname);
      } catch {}
      let decorative = false;
      for (let node = el; node; node = node.parentElement) {
        if (/(?:^|[\s_-])(?:hero|banner|image-callout|news|article|teaser|thumbnail|video)(?=$|[\s_-])/i.test(typeof node.className === "string" ? node.className : "")) decorative = true;
        if (node === scope?.node) break;
      }
      const relevant = Boolean(scope) && !ownerLink && !decorative;
      const storedAsset = Boolean(src || inlineSvg);
      if (!relevant || exclude.test(`${alt} ${src}`) || (!visible(el) && !(scope && storedAsset))) return;
      let description = ""; let parent = el.parentElement;
      for (let depth=0; parent && depth<6; depth++, parent=parent.parentElement) {
        const value=(parent.innerText||"").replace(/\s+/g," ").trim();
        if (value.length>=25 && value.length<=1600) { description=value; break; }
      }
      items.push({ src, kind, inlineSvg, alt, aria: el.getAttribute("aria-label") || "", title: el.getAttribute("title") || "", href: anchor?.href || "", linkText: anchor?.textContent?.trim().slice(0,160) || "", description, section: scope?.heading || (footer ? "Footer" : "Brand mark"), context: context.slice(0,500), selector: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).slice(0,2).join(".")}` : ""}` });
    };
    const srcsetUrl = (value = "") => value.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean).pop() || "";
    const imageSource = (img) => {
      const current = img.currentSrc || img.src || "";
      const deferred = img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-original") || srcsetUrl(img.getAttribute("data-srcset") || "") || srcsetUrl(img.getAttribute("srcset") || "");
      return (/^data:image\/svg\+xml[^,]*,%3Csvg/i.test(current) || /^data:image\/gif;base64,R0lGOD/i.test(current)) && deferred ? deferred : current || deferred;
    };
    for (const img of document.querySelectorAll("img")) { const src = imageSource(img); add(img, src, src.startsWith("data:image/") ? "data-image" : "image"); }
    for (const svg of document.querySelectorAll("svg")) add(svg, location.href, "inline-svg", new XMLSerializer().serializeToString(svg));
    for (const object of document.querySelectorAll('object[type^="image/"],object[data$=".svg"]')) add(object, object.data || object.getAttribute("data") || "", "image");
    for (const el of document.querySelectorAll("[style],section,footer,div,a")) {
      const bg = getComputedStyle(el).backgroundImage || "";
      for (const match of bg.matchAll(/url\(["']?(.*?)["']?\)/g)) add(el, new URL(match[1], location.href).href, "background");
    }
    const links = [...document.querySelectorAll("a[href]")].map((a) => ({ url: a.href, text: (a.textContent || a.getAttribute("aria-label") || "").trim().slice(0,180), context: contextFor(a).slice(0,300) })).filter((x) => cue.test(`${x.text} ${x.url} ${x.context}`));
    const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1200);
    return { title: document.title, url: location.href, items, links, partnerLabels: sectionLabels.map((el) => (directText(el) || el.textContent || "").trim()).filter(Boolean), appError: /application error|client-side exception|chunkloaderror/i.test(bodyText) ? bodyText : "" };
  });
  const candidates = raw.items.filter((x) => x.src || x.inlineSvg).map((item) => {
    const named = inferName({...item, siteTitle: raw.title, pageUrl: raw.url});
    const evidenceText = `${item.section} ${item.alt} ${item.context}`;
    const relationship = /federation|association/i.test(evidenceText) ? "Governing body" : /organis/i.test(evidenceText) ? "Organizer" : /supplier/i.test(evidenceText) ? "Supplier" : /sponsor|sponsored/i.test(evidenceText) ? "Sponsor" : /partner|mitra|supported|didukung/i.test(evidenceText) ? "Partner" : "Brand shown by site";
    return { ...named, relationship, section: item.section, evidence: [item.alt, item.linkText, item.section].filter(Boolean).join(" | "), sourcePage: raw.url, sourceUrl: item.src, brandUrl: item.href, kind: item.kind, selector: item.selector, inlineSvg: item.inlineSvg || undefined };
  }).filter((item) => !EXCLUDE.test(item.name));
  const warnings = [];
  if (candidates.some((c) => c.reviewRequired)) warnings.push("Some names were inferred from domains or filenames and require review.");
  if (raw.appError) warnings.push(`The rendered page reported a client-side application error: ${raw.appError.slice(0, 260)}`);
  if (raw.partnerLabels.length && !candidates.length) warnings.push(`Partner or sponsor labels were present (${[...new Set(raw.partnerLabels)].slice(0, 4).join(", ")}), but the page exposed no downloadable logo assets.`);
  return { title: raw.title, links: raw.links.map(({url,text}) => ({ url, text, priority: CONTEXT.test(text) ? 2 : 1 })), candidates, warnings };
}
