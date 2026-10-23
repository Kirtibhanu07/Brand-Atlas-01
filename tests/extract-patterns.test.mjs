import test from 'node:test';
import assert from 'node:assert/strict';
import {launchBrowser} from '../src/browser.mjs';
import {extractPage,inferName} from '../src/extract.mjs';

const image=(name,extra='')=>`<img alt="${name}" width="160" height="60" src="https://cdn.example/${name}.png" ${extra}>`;
test('sports section patterns, shadow DOM, deferred assets and sprite spans',async t=>{
 const browser=await launchBrowser();t.after(()=>browser.close());const page=await browser.newPage();
 await page.route('**/*',r=>r.abort());
 for(const label of ['Official Digital Streaming Partner','Nos partenaires','Patrocinadores','Unsere Sponsoren','スポンサー','赞助商']){
  await page.setContent(`<section><h2>${label}</h2><div>${image('Acme')}</div></section>`);
  assert.equal((await extractPage(page)).candidates.length,1,label);
 }
 await page.setContent(`<section class="sponsorCarousel"><span title="Acme" style="display:block;width:160px;height:60px;background-image:url('https://cdn.example/sprite.png');background-size:320px 60px;background-position:-160px 0px"></span><img alt="Deferred Brand" data-lazy="https://cdn.example/deferred.png"></section>`);
 let out=await extractPage(page);assert.ok(out.candidates.some(c=>c.kind==='css-sprite'&&c.crop.position==='-160px 0px'));assert.ok(out.candidates.some(c=>c.sourceUrl==='https://cdn.example/deferred.png'));
 await page.setContent('<div id="host"></div>');
 await page.evaluate(()=>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<section class="sponsorGrid"><img alt="Shadow Brand" src="https://cdn.example/brand.png" width="160" height="60"></section>');
 out=await extractPage(page);assert.equal(out.candidates[0].name,'Shadow Brand');
});
test('news cards with sponsor classes, generic footers and CTA slogans stay out',async t=>{
 const browser=await launchBrowser();t.after(()=>browser.close());const page=await browser.newPage();await page.route('**/*',r=>r.abort());
 await page.setContent(`<main><pk-card class="js-pk-card-sponsor"><figure class="article--img-wrap">${image('Matchday news')}</figure></pk-card><section><h2>Become a partner</h2>${image('Sales')}</section></main><footer>${image('Owner')}<nav><a href="/partners">Partners</a>${image('Navigation')}</nav></footer>`);
 assert.deepEqual((await extractPage(page)).candidates,[]);
});
test('SVG symbol references become standalone logos; controls do not become brands',async t=>{
 const browser=await launchBrowser();t.after(()=>browser.close());const page=await browser.newPage();
 await page.setContent('<svg style="display:none"><symbol id="brand"><rect width="80" height="40" fill="red"/></symbol></svg><section class="sponsors"><svg aria-label="Acme" width="80" height="40"><use href="#brand"/></svg><button><svg width="20" height="20"><path d="M0 0"/></svg></button></section>');
 const out=await extractPage(page);assert.equal(out.candidates.length,1);assert.match(out.candidates[0].inlineSvg,/<rect/);assert.doesNotMatch(out.candidates[0].inlineSvg,/<use/);
});
test('names ignore placeholder roles and decode optimized asset URLs',()=>{
 const candidate=inferName({alt:'UMPIRE PARTNER',src:'https://event.example/_next/image?url=https%3A%2F%2Fcdn.example%2Fwonder-cement-white_logo_versions.png',pageUrl:'https://event.example'});
 assert.equal(candidate.name,'Wonder Cement');assert.equal(candidate.reviewRequired,true);
 const placeholder=inferName({alt:'Partner Name',src:'https://cdn.example/4a98a189-6ace-4819-9cab-c068b9132150.svg'});assert.equal(placeholder.name,'Unknown logo');
 const prose=inferName({alt:'YONEX is a Japanese sporting goods manufacturer best known for its products in badminton, tennis and golf. It makes professional rackets and more.',src:'https://cdn.example/abc.svg'});assert.equal(prose.name,'YONEX');
});

test('page layout flags do not hide sponsor bars; real sponsor articles remain eligible',async t=>{
 const browser=await launchBrowser();t.after(()=>browser.close());const page=await browser.newPage();await page.route('**/*',r=>r.abort());
 await page.setContent(`<body><div class="body-navbar-cta-disabled"><main><div class="sponsorbar">${image('Acme')}</div><article class="sponsor-card">${image('New Balance')}</article></main></div></body>`);
 assert.deepEqual((await extractPage(page)).candidates.map(c=>c.name).sort(),['Acme','New Balance']);
});

test('metadata preserves real color words and removes website accessibility boilerplate',()=>{
 assert.equal(inferName({alt:'White Claw',src:'https://cdn.example/a.png'}).name,'White Claw');
 assert.equal(inferName({alt:'Black Diamond',src:'https://cdn.example/a.png'}).name,'Black Diamond');
 assert.equal(inferName({alt:'BMW Website.',src:'https://cdn.example/a.png'}).name,'BMW');
});
