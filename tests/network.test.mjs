import test from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, normalizeUrl, parseRobots } from "../src/network.mjs";

test("blocks private and reserved addresses", () => {
  for (const ip of ["127.0.0.1","10.2.3.4","172.16.0.1","192.168.1.1","169.254.169.254","::1","fc00::1","fe80::1","2001:db8::1","::ffff:127.0.0.1","::ffff:7f00:1"]) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8","1.1.1.1","2606:4700:4700::1111"]) assert.equal(isPublicAddress(ip), true, ip);
});

test("normalizes URLs and rejects unsafe forms", () => {
  assert.equal(normalizeUrl("/partners/?utm_source=x&a=1#logos", "https://example.com/home"), "https://example.com/partners?a=1");
  assert.throws(() => normalizeUrl("file:///etc/passwd"));
  assert.throws(() => normalizeUrl("http://user:pass@example.com/"));
  assert.throws(() => normalizeUrl("https://example.com:8443/"));
});

test("robots applies longest matching rule and crawl delay", () => {
  const rules = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 2\nSitemap: https://example.com/sitemap.xml");
  assert.equal(rules.isAllowed("https://example.com/private/file"), false);
  assert.equal(rules.isAllowed("https://example.com/private/public/logo"), true);
  assert.equal(rules.isAllowed("https://example.com/partners"), true);
  assert.equal(rules.crawlDelayMs, 2000);
  assert.deepEqual(rules.sitemaps, ["https://example.com/sitemap.xml"]);
});
