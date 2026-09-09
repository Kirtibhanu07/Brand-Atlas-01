import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

function ipv4Int(ip) {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
    ? (((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3]) >>> 0 : null;
}

function in4(ip, cidr, bits) {
  const a = ipv4Int(ip), b = ipv4Int(cidr);
  if (a === null || b === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

export function isPublicAddress(address) {
  if (net.isIP(address) === 4) {
    return ![["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],
      ["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],
      ["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],
      ["224.0.0.0",4],["240.0.0.0",4]].some(([n,b]) => in4(address,n,b));
  }
  if (net.isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a === "::" || a === "::1" || a.startsWith("fc") || a.startsWith("fd") ||
        /^fe[89ab]/.test(a) || a.startsWith("ff")) return false;
    if (a.startsWith("::ffff:")) {
      const tail = a.slice(7);
      if (tail.includes(".")) return isPublicAddress(tail);
      const parts = tail.split(":");
      if (parts.length === 2 && parts.every((p) => /^[0-9a-f]{1,4}$/.test(p))) {
        const value = (parseInt(parts[0],16) * 65536 + parseInt(parts[1],16)) >>> 0;
        return isPublicAddress(`${value>>>24}.${(value>>>16)&255}.${(value>>>8)&255}.${value&255}`);
      }
      return false;
    }
    return !a.startsWith("2001:db8");
  }
  return false;
}

export function normalizeUrl(value, base) {
  const url = new URL(value, base);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error(`Unsupported URL: ${url.href}`);
  }
  if ((url.protocol === "http:" && url.port && url.port !== "80") ||
      (url.protocol === "https:" && url.port && url.port !== "443")) {
    throw new Error(`Only standard web ports are allowed: ${url.href}`);
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
  }
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

export async function assertPublicUrl(value) {
  const href = normalizeUrl(value);
  const url = new URL(href);
  if (/^(localhost|.+\.localhost|.+\.local)$/i.test(url.hostname)) throw new Error("Local hosts are blocked");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const answers = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!answers.length || answers.some(({address}) => !isPublicAddress(address))) {
    throw new Error(`Private or reserved address blocked for ${url.hostname}`);
  }
  return { url, answers };
}

function decodeBody(buffer, encoding) {
  if (encoding === "gzip") return zlib.gunzipSync(buffer);
  if (encoding === "deflate") return zlib.inflateSync(buffer);
  if (encoding === "br") return zlib.brotliDecompressSync(buffer);
  return buffer;
}

export async function safeFetch(value, options = {}) {
  const { maxBytes = 12_000_000, timeoutMs = 25_000, method = "GET", headers = {}, maxRedirects = 5 } = options;
  let href = normalizeUrl(value);
  for (let redirects = 0; ; redirects++) {
    const { url, answers } = await assertPublicUrl(href);
    const chosen = answers[0];
    const client = url.protocol === "https:" ? https : http;
    const result = await new Promise((resolve, reject) => {
      const req = client.request(url, {
        method,
        headers: { "user-agent": "BrandAtlas/1.0 (+website brand inventory)", accept: "*/*", "accept-encoding": "gzip, deflate, br", ...headers },
        lookup: (_host, opts, cb) => opts?.all
          ? cb(null, [{ address: chosen.address, family: chosen.family }])
          : cb(null, chosen.address, chosen.family),
        timeout: timeoutMs,
      }, (res) => {
        const chunks = []; let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) req.destroy(new Error(`Response exceeded ${maxBytes} bytes`));
          else chunks.push(chunk);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      });
      req.on("timeout", () => req.destroy(new Error(`Request timed out after ${timeoutMs} ms`)));
      req.on("error", reject);
      req.end();
    });
    if ([301,302,303,307,308].includes(result.status) && result.headers.location) {
      if (redirects >= maxRedirects) throw new Error("Too many redirects");
      href = normalizeUrl(result.headers.location, href);
      continue;
    }
    const body = decodeBody(result.body, String(result.headers["content-encoding"] ?? "").toLowerCase());
    if (body.length > maxBytes) throw new Error(`Decoded response exceeded ${maxBytes} bytes`);
    return { url: href, ...result, body };
  }
}

function compileRobots(rule) {
  const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}${rule.endsWith("$") ? "" : ".*"}`.replace("$.*", "$"));
}

export function parseRobots(text, userAgent = "BrandAtlas") {
  const groups = []; let current = null;
  const sitemaps = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim(); if (!line.includes(":")) continue;
    const [keyRaw, ...rest] = line.split(":"); const key = keyRaw.toLowerCase(); const value = rest.join(":").trim();
    if (key === "user-agent") { current = { agent: value.toLowerCase(), rules: [], delay: 0 }; groups.push(current); }
    else if (key === "sitemap") sitemaps.push(value);
    else if (current && (key === "allow" || key === "disallow") && value) current.rules.push({ allow: key === "allow", value, re: compileRobots(value) });
    else if (current && key === "crawl-delay") current.delay = Math.max(0, Number(value) * 1000 || 0);
  }
  const ua = userAgent.toLowerCase();
  const selected = groups.filter((g) => ua.includes(g.agent) || g.agent === "*");
  const exact = selected.filter((g) => g.agent !== "*"); const active = exact.length ? exact : selected;
  const rules = active.flatMap((g) => g.rules); const crawlDelayMs = Math.max(0, ...active.map((g) => g.delay));
  return { sitemaps, crawlDelayMs, isAllowed(value) { const u = new URL(value, "https://robots.invalid"); const matches = rules.filter((r) => r.re.test(u.pathname + u.search)).sort((a,b) => b.value.length - a.value.length || Number(b.allow)-Number(a.allow)); return matches[0]?.allow ?? true; } };
}
