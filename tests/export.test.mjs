import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exportReport } from "../src/export.mjs";

test("writes safe, searchable report formats", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "brand-atlas-"));
  const manifest = {sourceUrl:"https://example.com/",finishedAt:"2026-01-01T00:00:00Z",coverage:{status:"bounded",pagesVisited:1,warnings:[]},brands:[{id:"acme",name:"=ACME <Co>",relationship:"Partner",section:"Partners",confidence:.92,reviewRequired:false,brandUrl:"https://acme.example",evidence:[{sourcePage:"https://example.com/"}],logos:[]}]};
  await exportReport(manifest, dir, {pptx:false,zip:false});
  const [html,csv,json] = await Promise.all(["index.html","brands.csv","brands.json"].map((f) => fs.readFile(path.join(dir,f),"utf8")));
  assert.match(html, /=ACME &lt;Co&gt;/); assert.doesNotMatch(html, /<h2>=ACME <Co>/);
  assert.match(csv, /'=ACME <Co>/); assert.equal(JSON.parse(json).brands.length, 1);
});

test("writes a cloud-compatible PowerPoint", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "brand-atlas-pptx-"));
  const manifest = {sourceUrl:"https://example.com/",finishedAt:"2026-01-01T00:00:00Z",coverage:{status:"bounded",pagesVisited:1,warnings:[]},brands:[{id:"acme",name:"Acme Sports",relationship:"Sponsor",section:"Official sponsors",confidence:.92,reviewRequired:false,brandUrl:"https://acme.example",evidence:[{sourcePage:"https://example.com/"}],logos:[]}]};
  const previous = process.env.BRAND_ATLAS_PPTX_ENGINE;
  process.env.BRAND_ATLAS_PPTX_ENGINE = "portable";
  try { await exportReport(manifest, dir, {pptx:true,zip:false}); }
  finally { if (previous === undefined) delete process.env.BRAND_ATLAS_PPTX_ENGINE; else process.env.BRAND_ATLAS_PPTX_ENGINE = previous; }
  const file = await fs.readFile(path.join(dir,"brand-atlas.pptx"));
  assert.equal(file.subarray(0,2).toString(), "PK");
  assert.ok(file.length > 10_000);
});


for (const background of ["white", "black"]) {
  test(`exports ${background} slides and logo backgrounds with readable text`, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "brand-atlas-theme-"));
    const manifest = {sourceUrl:"https://example.com/", options:{background}, finishedAt:"2026-01-01", coverage:{status:"bounded",pagesVisited:1,warnings:[]},brands:[{name:"White logo",relationship:"Sponsor",confidence:1,reviewRequired:false,evidence:[],logos:[]}]};
    const previous = process.env.BRAND_ATLAS_PPTX_ENGINE;
    process.env.BRAND_ATLAS_PPTX_ENGINE = "portable";
    try {
      await exportReport(manifest, dir, {zip:true});
      const zip = await JSZip.loadAsync(await fs.readFile(path.join(dir, "brand-atlas.pptx")));
      for (const name of ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']) {
        const xml = await zip.file(name).async('string');
        assert.match(xml, new RegExp(`<p:bg>.*?srgbClr val="${background === 'black' ? '000000' : 'FFFFFF'}"`));
        assert.match(xml, new RegExp(`srgbClr val="${background === 'black' ? 'FFFFFF' : '101828'}"`));
      }
      const html = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
      assert.match(html, new RegExp(`place-items:center;background:#${background === 'black' ? '000000' : 'FFFFFF'}`));
      const bundle = await JSZip.loadAsync(await fs.readFile(path.join(dir, 'brand-atlas.zip')));
      assert.equal(JSON.parse(await bundle.file('brands.json').async('string')).options.background, background);
    } finally {
      if (previous === undefined) delete process.env.BRAND_ATLAS_PPTX_ENGINE;
      else process.env.BRAND_ATLAS_PPTX_ENGINE = previous;
      await fs.rm(dir, {recursive:true, force:true});
    }
  });
}
