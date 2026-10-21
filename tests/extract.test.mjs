import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { cleanName, extractPage, inferName } from "../src/extract.mjs";

test("name inference identifies trustworthy alt text and reviewable domains", () => {
  assert.equal(cleanName("acme-logo-white.svg"), "acme");
  assert.deepEqual(inferName({alt:"Acme",aria:"",title:"",linkText:"",href:"",src:"https://x.test/a.svg"}).reviewRequired, false);
  const inferred = inferName({alt:"",aria:"",title:"",linkText:"",href:"https://whoop.com/about",src:"https://cdn.test/a9f.svg"});
  assert.equal(inferred.name, "Whoop"); assert.equal(inferred.reviewRequired, true);
  const hosted = inferName({alt:".",aria:"",title:"",linkText:". .",href:"https://ghostwhite-cassowary-457839.hostingersite.com/contacts/",src:"https://cdn.example/akeo-logo.png",pageUrl:"https://club.example/"});
  assert.equal(hosted.name, "Akeo");
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

test("extracts lazy and hidden carousel logos when the sponsor label is a sibling", async (t) => {
  let browser;
  try { browser = await chromium.launch({headless:true}); }
  catch { try { browser = await chromium.launch({headless:true, executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}); } catch { return t.skip("Chromium is not installed"); } }
  const page = await browser.newPage({viewport:{width:1200,height:800}});
  await page.setContent(`<title>Club</title><section><div><h2>SPONSORED BY</h2></div><div><div><div><div><div><div><img alt="Akeo" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" data-src="https://cdn.example/akeo.png" style="display:none"></div></div></div></div></div></div></section>`);
  const result = await extractPage(page); await browser.close();
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, "Akeo");
  assert.equal(result.candidates[0].sourceUrl, "https://cdn.example/akeo.png");
  assert.equal(result.candidates[0].relationship, "Sponsor");
});


test("footer sponsor evidence does not spread to owner, utility, app or provider marks", async (t) => {
  let browser;
  try { browser = await chromium.launch({headless:true}); }
  catch { try { browser = await chromium.launch({headless:true, executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}); } catch { return t.skip("Chromium is not installed"); } }
  try {
    const page = await browser.newPage();
    const img = (name) => `<img alt="${name}" src="https://cdn.example/${name}.png" width="160" height="60">`;
    await page.setContent(`<header>${img('League')}</header>
      <main><section><h2>News</h2>${img('Story')}</section>
      <a aria-label="Highlights | Powered by Toyota">${img('Match photo')}<svg width="20" height="20"></svg></a></main>
      <footer>${img('Owner')}<nav><a href="/partners">Partners</a>${img('Navigation')}</nav>
      <section class="official-partners"><div class="image-callout">${img('Sponsors')}</div><h2>Official partners</h2><div>${img('Acme')}${img('Lightmark')}</div></section>
      <div>${img('Provider')}</div><div class="footer__bottom"><div class="title-sponsors">${img('Owner Composite')}</div></div><div><h3>Get our app</h3>${img('App Store')}</div>
      <div class="federation">${img('Federation')}</div></footer>`);
    let out = await extractPage(page);
    assert.deepEqual(out.candidates.map(c => c.name).sort(), ['Acme', 'Lightmark']);
    await page.setContent(`<footer>${img('Owner')}<h2>Official sponsors</h2><ul><li>${img('Acme')}</li></ul><div>${img('Provider')}</div><h3>Follow us</h3>${img('Social')}</footer>`);
    out = await extractPage(page);
    assert.deepEqual(out.candidates.map(c => c.name), ['Acme']);
    await page.setContent(`<main><section><h2>Partners</h2><div>${img('Acme')}</div><h2>Latest news</h2>${img('Story')}</section><div>${img('Provider')}</div></main>`);
    out = await extractPage(page);
    assert.deepEqual(out.candidates.map(c => c.name), ['Acme']);
  } finally { await browser.close(); }
});
