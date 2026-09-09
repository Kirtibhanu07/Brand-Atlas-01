import test from "node:test";
import assert from "node:assert/strict";
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
