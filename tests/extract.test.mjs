import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { cleanName, extractPage, inferName } from "../src/extract.mjs";

test("name inference identifies trustworthy alt text and reviewable domains", () => {
  assert.equal(cleanName("acme-logo-white.svg"), "acme");
  assert.deepEqual(inferName({alt:"Acme",aria:"",title:"",linkText:"",href:"",src:"https://x.test/a.svg"}).reviewRequired, false);
  const inferred = inferName({alt:"",aria:"",title:"",linkText:"",href:"https://whoop.com/about",src:"https://cdn.test/a9f.svg"});
  assert.equal(inferred.name, "Whoop"); assert.equal(inferred.reviewRequired, true);
});

test("extracts partner marks with evidence and excludes social icons", async (t) => {
  let browser;
  try { browser = await chromium.launch({headless:true}); }
  catch { try { browser = await chromium.launch({headless:true, executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}); } catch { return t.skip("Chromium is not installed"); } }
  const page = await browser.newPage({viewport:{width:1200,height:800}});
  await page.setContent(`<title>Fixture</title><section class="tour-partners"><h2>Tour partners</h2><a href="https://acme.example"><img alt="Acme Sports" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='80'%3E%3Crect width='200' height='80' fill='red'/%3E%3C/svg%3E" width="200" height="80"></a><a href="https://social.example"><img alt="Instagram icon" src="social-icon.svg" width="40" height="40"></a></section>`);
  const result = await extractPage(page); await browser.close();
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, "Acme Sports");
  assert.equal(result.candidates[0].relationship, "Partner");
  assert.match(result.candidates[0].evidence, /Tour partners/i);
});
