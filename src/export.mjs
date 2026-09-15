import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const csvCell = (v = "") => { let s = String(v).replace(/\r?\n/g, " "); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };

async function asDataUrl(file) {
  if (!file) return "";
  try { const data = await fs.readFile(file); const ext = path.extname(file).slice(1).replace("jpg", "jpeg"); return `data:image/${ext};base64,${data.toString("base64")}`; } catch { return ""; }
}

function csv(manifest) {
  const rows = [["brand","relationship","section","confidence","review_required","brand_url","logo_file","logo_source","evidence_page"]];
  for (const b of manifest.brands) for (const logo of b.logos.length ? b.logos : [{}]) rows.push([b.name,b.relationship,b.section,b.confidence,b.reviewRequired,b.brandUrl,logo.path,logo.sourceUrl,b.evidence[0]?.sourcePage]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

async function html(manifest, outputDir) {
  const cards = [];
  for (const b of manifest.brands) {
    const logo = b.logos.find((l) => l.previewPath)?.previewPath || b.logos[0]?.path;
    const image = await asDataUrl(logo ? path.join(outputDir, logo) : "");
    cards.push(`<article class="brand" data-q="${esc(`${b.name} ${b.relationship} ${b.section}`.toLowerCase())}" data-review="${b.reviewRequired}">
      <div class="mark">${image ? `<img src="${image}" alt="${esc(b.name)} logo">` : `<span>No preview</span>`}</div>
      <h2>${esc(b.name)}</h2><p>${esc(b.relationship)} · ${esc(b.section || "Unlabelled section")}</p>
      <div class="meta"><span>${Math.round(Number(b.confidence) * 100)}% name confidence</span>${b.reviewRequired ? '<b>Review name</b>' : ''}</div>
      <nav>${b.logos[0]?.path ? `<a href="${esc(b.logos[0].path)}" download>Download logo</a>` : ""}${b.brandUrl ? `<a href="${esc(b.brandUrl)}">Brand link</a>` : ""}<a href="${esc(b.evidence[0]?.sourcePage || manifest.sourceUrl)}">Source page</a></nav>
    </article>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Brand Atlas</title><style>
  :root{--ink:#101828;--muted:#667085;--gold:#b6893d;--paper:#f7f4ed}*{box-sizing:border-box}body{margin:0;font:15px/1.45 Inter,Arial,sans-serif;color:var(--ink);background:var(--paper)}header{padding:54px clamp(22px,5vw,76px) 32px;background:#111827;color:white}header small{letter-spacing:.18em;text-transform:uppercase;color:#d7b56d}h1{font-size:clamp(36px,6vw,68px);line-height:1;margin:12px 0}header p{max-width:780px;color:#d0d5dd}.bar{position:sticky;top:0;z-index:2;display:flex;gap:12px;padding:14px clamp(22px,5vw,76px);background:#fff;border-bottom:1px solid #e4dfd3}.bar input{flex:1;max-width:540px;padding:12px 14px;border:1px solid #ccc;border-radius:4px}.bar button{padding:10px 14px;border:1px solid #aaa;background:white;border-radius:4px}main{padding:34px clamp(22px,5vw,76px) 70px}.coverage{margin-bottom:30px;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:34px 26px}.brand{min-width:0}.mark{height:150px;display:grid;place-items:center;background:white;border:1px solid #e7e1d4}.mark img{max-width:82%;max-height:78%;object-fit:contain}.mark span{color:#98a2b3}.brand h2{margin:13px 0 4px;font-size:22px}.brand p{margin:0;color:var(--muted)}.meta{display:flex;gap:10px;margin:9px 0;color:var(--muted);font-size:12px}.meta b{color:#9a3412}.brand nav{display:flex;flex-wrap:wrap;gap:13px}.brand a{color:#7b571f}footer{padding:25px clamp(22px,5vw,76px);border-top:1px solid #ddd;color:var(--muted)}@media(max-width:560px){.bar{flex-wrap:wrap}.bar input{width:100%;flex-basis:100%}}
  </style></head><body><header><small>Website evidence report</small><h1>Brand Atlas</h1><p>${esc(manifest.sourceUrl)}<br>Captured ${esc(manifest.finishedAt)}. This bounded crawl found ${manifest.brands.length} brand records across ${manifest.coverage.pagesVisited} pages.</p></header>
  <div class="bar"><input id="q" aria-label="Search brands" placeholder="Search brand, relationship, or section"><button id="all">All</button><button id="review">Needs review</button></div>
  <main><p class="coverage"><b>Coverage: ${esc(manifest.coverage.status)}</b> · ${esc(manifest.coverage.warnings.join(" ") || "No crawl warnings.")}</p><section class="grid">${cards.join("\n")}</section></main>
  <footer>Names marked for review were inferred from website metadata, domains, or asset filenames. Open the source evidence before publishing.</footer><script>const q=document.querySelector('#q'),cards=[...document.querySelectorAll('.brand')];let review=false;function f(){let v=q.value.toLowerCase();cards.forEach(c=>c.hidden=!c.dataset.q.includes(v)||(review&&c.dataset.review!=='true'))}q.oninput=f;all.onclick=()=>{review=false;f()};review.onclick=()=>{review=true;f()}</script></body></html>`;
}

function addText(slide, text, position, style) {
  const box = slide.shapes.add({ geometry: "textbox", position, fill: "none", line: { fill: "none", width: 0 } });
  box.text = text; box.text.style = { typeface: "Arial", autoFit: "shrinkText", margin: 0, ...style }; return box;
}

async function writePptxWithArtifactTool(manifest, outputDir) {
  const { Presentation, PresentationFile } = await import("@oai/artifact-tool");
  const p = Presentation.create({ slideSize: { width: 1280, height: 720 } });
  let slide = p.slides.add(); slide.background.fill = "#101828";
  addText(slide, "BRAND ATLAS", {left:72,top:98,width:850,height:58}, {fontSize:18,bold:true,color:"#D7B56D",characterSpacing:3});
  addText(slide, "Sponsors and partners\nfound on the website", {left:72,top:175,width:1000,height:190}, {fontSize:52,bold:true,color:"#FFFFFF"});
  addText(slide, new URL(manifest.sourceUrl).hostname, {left:72,top:430,width:700,height:45}, {fontSize:24,color:"#D0D5DD"});
  addText(slide, `${manifest.brands.length} records · ${manifest.coverage.pagesVisited} pages · ${manifest.coverage.status} crawl`, {left:72,top:610,width:900,height:28}, {fontSize:15,color:"#98A2B3"});
  slide.speakerNotes.textFrame.setText(`Source website: ${manifest.sourceUrl}\nCaptured: ${manifest.finishedAt}\nCoverage: ${manifest.coverage.status}`);
  const per = 8;
  for (let offset = 0; offset < manifest.brands.length; offset += per) {
    slide = p.slides.add(); slide.background.fill = "#FFFFFF";
    addText(slide, "Brand inventory", {left:54,top:28,width:780,height:48}, {fontSize:30,bold:true,color:"#101828"});
    addText(slide, `${offset + 1}–${Math.min(offset + per, manifest.brands.length)} of ${manifest.brands.length}`, {left:980,top:39,width:240,height:30}, {fontSize:12,color:"#667085",alignment:"right"});
    const group = manifest.brands.slice(offset, offset + per); const notes = [];
    for (let i = 0; i < group.length; i++) {
      const b = group[i], col = i % 4, row = Math.floor(i / 4); const left = 52 + col * 304, top = 105 + row * 190;
      const preview = b.logos.find((l) => l.previewPath)?.previewPath || b.logos[0]?.path;
      if (preview) { try { const bytes = await fs.readFile(path.join(outputDir, preview)); slide.images.add({ blob: new Uint8Array(bytes), contentType: "image/png", alt: `${b.name} logo`, fit: "contain", position: {left,top,width:250,height:104} }); } catch {} }
      addText(slide, b.name, {left,top:top+118,width:250,height:28}, {fontSize:16,bold:true,color:"#101828",alignment:"center"});
      addText(slide, `${b.relationship}${b.reviewRequired ? " · REVIEW" : ""}`, {left,top:top+148,width:250,height:30}, {fontSize:9,bold:b.reviewRequired,color:b.reviewRequired?"#9A3412":"#667085",alignment:"center"});
      notes.push(`${b.name}\nSource: ${b.evidence[0]?.sourcePage || manifest.sourceUrl}\nLogo: ${b.logos[0]?.sourceUrl || "Unavailable"}`);
    }
    addText(slide, "Names marked REVIEW need human confirmation before external use.", {left:54,top:680,width:850,height:18}, {fontSize:10,color:"#667085"});
    slide.speakerNotes.textFrame.setText(notes.join("\n\n"));
  }
  const pptxPath = path.join(outputDir, "brand-atlas.pptx");
  await (await PresentationFile.exportPptx(p)).save(pptxPath);
  return pptxPath;
}

function containBox(width, height, box) {
  const ratio = Math.max(1, Number(width) || 900) / Math.max(1, Number(height) || 420);
  let w = box.w, h = w / ratio;
  if (h > box.h) { h = box.h; w = h * ratio; }
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

async function removeMissingContentTypeTargets(pptxPath) {
  const zip = await JSZip.loadAsync(await fs.readFile(pptxPath));
  const contentTypes = zip.file("[Content_Types].xml");
  if (!contentTypes) return;
  let xml = await contentTypes.async("string");
  for (const match of [...xml.matchAll(/<Override\b[^>]*PartName="\/([^"]+)"[^>]*\/>/g)]) {
    if (!zip.file(match[1])) xml = xml.replace(match[0], "");
  }
  zip.file("[Content_Types].xml", xml);
  await fs.writeFile(pptxPath, await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"}));
}

async function writePptxPortable(manifest, outputDir) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Brand Atlas";
  pptx.subject = `Sponsors and partners found on ${manifest.sourceUrl}`;
  pptx.title = `Brand Atlas — ${new URL(manifest.sourceUrl).hostname}`;
  pptx.company = "Brand Atlas";
  pptx.lang = "en-US";
  pptx.theme = { headFontFace: "Arial", bodyFontFace: "Arial", lang: "en-US" };

  let slide = pptx.addSlide();
  slide.background = { color: "101828" };
  slide.addText("BRAND ATLAS", {x:.75,y:1.05,w:8.8,h:.35,fontFace:"Arial",fontSize:13,bold:true,color:"D7B56D",charSpacing:3,margin:0});
  slide.addText("Sponsors and partners\nfound on the website", {x:.75,y:1.78,w:10.8,h:1.85,fontFace:"Arial",fontSize:38,bold:true,color:"FFFFFF",breakLine:false,margin:0,fit:"shrink"});
  slide.addText(new URL(manifest.sourceUrl).hostname, {x:.75,y:4.5,w:7.4,h:.45,fontFace:"Arial",fontSize:18,color:"D0D5DD",margin:0});
  slide.addText(`${manifest.brands.length} records   ${manifest.coverage.pagesVisited} pages   ${manifest.coverage.status} crawl`, {x:.75,y:6.65,w:9.5,h:.25,fontFace:"Arial",fontSize:10,color:"98A2B3",margin:0});
  slide.addNotes(`Source website: ${manifest.sourceUrl}\nCaptured: ${manifest.finishedAt}\nCoverage: ${manifest.coverage.status}`);

  const perSlide = 8;
  for (let offset = 0; offset < manifest.brands.length; offset += perSlide) {
    slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText("Brand inventory", {x:.55,y:.3,w:8.2,h:.5,fontFace:"Arial",fontSize:24,bold:true,color:"101828",margin:0});
    slide.addText(`${offset + 1}–${Math.min(offset + perSlide, manifest.brands.length)} of ${manifest.brands.length}`, {x:10.7,y:.4,w:2.0,h:.25,fontFace:"Arial",fontSize:9,color:"667085",align:"right",margin:0});
    const group = manifest.brands.slice(offset, offset + perSlide); const notes = [];
    for (let index = 0; index < group.length; index++) {
      const brand = group[index], col = index % 4, row = Math.floor(index / 4);
      const x = .55 + col * 3.18, y = 1.1 + row * 2.55;
      const logo = brand.logos.find((item) => item.previewPath) || brand.logos[0];
      if (logo?.previewPath || logo?.path) {
        const file = path.join(outputDir, logo.previewPath || logo.path);
        try { await fs.access(file); slide.addImage({path:file,...containBox(logo.width, logo.height, {x,y,w:2.62,h:1.35})}); } catch {}
      }
      slide.addText(brand.name, {x,y:y+1.48,w:2.62,h:.35,fontFace:"Arial",fontSize:12,bold:true,color:"101828",align:"center",valign:"mid",fit:"shrink",margin:0});
      slide.addText(`${brand.relationship}${brand.reviewRequired ? "   REVIEW" : ""}`, {x,y:y+1.88,w:2.62,h:.32,fontFace:"Arial",fontSize:8,bold:brand.reviewRequired,color:brand.reviewRequired?"9A3412":"667085",align:"center",fit:"shrink",margin:0});
      notes.push(`${brand.name}\nSource: ${brand.evidence[0]?.sourcePage || manifest.sourceUrl}\nLogo: ${brand.logos[0]?.sourceUrl || "Unavailable"}`);
    }
    slide.addText("Names marked REVIEW need human confirmation before external use.", {x:.55,y:7.15,w:8.8,h:.18,fontFace:"Arial",fontSize:7,color:"667085",margin:0});
    slide.addNotes(notes.join("\n\n"));
  }
  const pptxPath = path.join(outputDir, "brand-atlas.pptx");
  await pptx.writeFile({ fileName: pptxPath });
  await removeMissingContentTypeTargets(pptxPath);
  return pptxPath;
}

async function writePptx(manifest, outputDir) {
  if (process.env.BRAND_ATLAS_PPTX_ENGINE === "portable") return writePptxPortable(manifest, outputDir);
  try { return await writePptxWithArtifactTool(manifest, outputDir); }
  catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND" && !/Cannot find package.*artifact-tool/i.test(error?.message || "")) throw error;
    return writePptxPortable(manifest, outputDir);
  }
}

export async function exportReport(manifest, outputDir, options = {}) {
  await fs.mkdir(outputDir, { recursive: true }); const files = [];
  const jsonPath = path.join(outputDir, "brands.json"); await fs.writeFile(jsonPath, JSON.stringify(manifest, null, 2)); files.push(jsonPath);
  const csvPath = path.join(outputDir, "brands.csv"); await fs.writeFile(csvPath, csv(manifest)); files.push(csvPath);
  const htmlPath = path.join(outputDir, "index.html"); await fs.writeFile(htmlPath, await html(manifest, outputDir)); files.push(htmlPath);
  if (options.pptx !== false) files.push(await writePptx(manifest, outputDir));
  if (options.zip !== false) {
    const zip = new JSZip();
    for (const file of files) zip.file(path.relative(outputDir, file), await fs.readFile(file));
    for (const b of manifest.brands) for (const l of b.logos) for (const rel of [l.path,l.previewPath].filter(Boolean)) { try { zip.file(rel, await fs.readFile(path.join(outputDir, rel))); } catch {} }
    const zipPath = path.join(outputDir, "brand-atlas.zip"); await fs.writeFile(zipPath, await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"})); files.push(zipPath);
  }
  return files;
}
