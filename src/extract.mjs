const CONTEXT = /\b(partners?|sponsors?|supported by|presented by|official supplier|organisers?|organizers?|federation|associations?|clients?)\b/i;
const EXCLUDE = /\b(header|qr(?:\s*code)?|icon|arrow|caret|chevron|search|menu|close|play|ticket|watch|facebook|instagram|youtube|linkedin|tiktok|twitter|x-logo|avatar|thumbnail|flag)\b/i;

export function cleanName(value = "") {
  return value.replace(/\.(svg|png|jpe?g|webp|gif|avif)(\?.*)?$/i, "")
    .replace(/[_-]+/g, " ").replace(/\b(logo|partner|sponsor|white|black|colour|color|desktop|mobile|new)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
}

export function inferName(meta) {
  const values = [meta.alt, meta.aria, meta.title, meta.linkText].map(cleanName).filter(Boolean);
  const explicit = values.find((v) => v.length > 1 && !EXCLUDE.test(v));
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
      if (base && !/premierpadel|invalid|localhost/i.test(base)) return { name: cleanName(base).replace(/\b\w/g, (c) => c.toUpperCase()), nameSource: "linked domain", confidence: 0.72, reviewRequired: true };
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
    const cue = /\b(partners?|sponsors?|supported by|presented by|official supplier|organisers?|organizers?|federation|associations?|clients?)\b/i;
    const exclude = /\b(header|qr(?:\s*code)?|icon|arrow|caret|chevron|search|menu|close|play|ticket|watch|facebook|instagram|youtube|linkedin|tiktok|twitter|avatar|thumbnail|flag)\b/i;
    const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) !== 0 && r.width >= 20 && r.height >= 12; };
    const partnerScope = (el) => {
      let node = el;
      for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
        const marker = `${node.id || ""} ${typeof node.className === "string" ? node.className : ""}`;
        const own = node.matches?.("section,footer,aside,main,div,li") ? [...node.querySelectorAll(":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > [role=heading]")] : [];
        const h = own.find((x) => cue.test(x.textContent || ""));
        if (cue.test(marker) || h) {
          const label = h?.textContent.trim() || (marker.match(cue)?.[0] || "Brand mark");
          return { node, heading: label.replace(/\b\w/g, (c) => c.toUpperCase()) };
        }
      }
      return null;
    };
    const contextFor = (el) => {
      let n = el; const parts = [];
      for (let depth = 0; n && depth < 5; depth++, n = n.parentElement) parts.push(`${n.id || ""} ${n.className || ""}`);
      return parts.join(" ");
    };
    const items = [];
    const add = (el, src, kind, inlineSvg = "") => {
      const anchor = el.closest("a[href]"); const context = contextFor(el); const alt = el.getAttribute("alt") || ""; const scope = partnerScope(el); const footer = el.closest("footer");
      const footerLogo = footer && el.tagName === "IMG" && (alt || /logo/i.test(src));
      const relevant = Boolean(scope || footerLogo || /(?:^|[/_-])(sponsor|partner)(?:[/_.-]|$)/i.test(src) || /\b(sponsor|partner|federation)\b/i.test(alt));
      if (!relevant || exclude.test(`${alt} ${src}`) || !visible(el)) return;
      let description = ""; let parent = el.parentElement;
      for (let depth=0; parent && depth<6; depth++, parent=parent.parentElement) {
        const value=(parent.innerText||"").replace(/\s+/g," ").trim();
        if (value.length>=25 && value.length<=1600) { description=value; break; }
      }
      items.push({ src, kind, inlineSvg, alt, aria: el.getAttribute("aria-label") || "", title: el.getAttribute("title") || "", href: anchor?.href || "", linkText: anchor?.textContent?.trim().slice(0,160) || "", description, section: scope?.heading || (footer ? "Footer" : "Brand mark"), context: context.slice(0,500), selector: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).slice(0,2).join(".")}` : ""}` });
    };
    for (const img of document.querySelectorAll("img")) add(img, img.currentSrc || img.src || img.getAttribute("data-src") || "", "image");
    for (const svg of document.querySelectorAll("svg")) add(svg, location.href, "inline-svg", new XMLSerializer().serializeToString(svg));
    for (const el of document.querySelectorAll("[style],section,footer,div,a")) {
      const bg = getComputedStyle(el).backgroundImage; const m = bg?.match(/^url\(["']?(.*?)["']?\)$/); if (m) add(el, new URL(m[1], location.href).href, "background");
    }
    const links = [...document.querySelectorAll("a[href]")].map((a) => ({ url: a.href, text: (a.textContent || a.getAttribute("aria-label") || "").trim().slice(0,180), context: contextFor(a).slice(0,300) })).filter((x) => cue.test(`${x.text} ${x.url}`));
    return { title: document.title, url: location.href, items, links };
  });
  const candidates = raw.items.filter((x) => x.src || x.inlineSvg).map((item) => {
    const named = inferName({...item, siteTitle: raw.title});
    const relationship = /federation|association/i.test(`${item.section} ${item.alt} ${item.context}`) ? "Governing body" : /organis/i.test(item.context) ? "Organizer" : /sponsor/i.test(`${item.section} ${item.context}`) ? "Sponsor" : /partner/i.test(`${item.section} ${item.context}`) ? "Partner" : "Brand shown by site";
    return { ...named, relationship, section: item.section, evidence: [item.alt, item.linkText, item.section].filter(Boolean).join(" | "), sourcePage: raw.url, sourceUrl: item.src, brandUrl: item.href, kind: item.kind, selector: item.selector, inlineSvg: item.inlineSvg || undefined };
  }).filter((item) => !EXCLUDE.test(item.name));
  return { title: raw.title, links: raw.links.map(({url,text}) => ({ url, text, priority: CONTEXT.test(text) ? 2 : 1 })), candidates, warnings: candidates.some((c) => c.reviewRequired) ? ["Some names were inferred from domains or filenames and require review."] : [] };
}
