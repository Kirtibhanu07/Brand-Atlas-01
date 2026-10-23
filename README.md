# Brand Atlas

Brand Atlas accepts one public website URL and builds a reviewable inventory of sponsors and partners evidenced by labeled commercial sections on that website. It uses the rendered page, so it can see logos loaded by JavaScript and lazy loading.

The output folder contains:

- `logos/`: untouched website logo assets
- `previews/`: normalized PNG previews for reports and PowerPoint
- `brands.json`: structured records with confidence, evidence, and crawl coverage
- `brands.csv`: spreadsheet-ready inventory with formula-injection protection
- `index.html`: offline searchable review gallery
- `brand-atlas.pptx`: 16:9 logo deck with evidence URLs in speaker notes
- `brand-atlas.zip`: portable package of the reports and images

## Quick start

Requires Node.js 20 or newer.

```bash
npm install
npx playwright install chromium
npm start -- https://premierpadel.com/en/home-page --output output/premier-padel
```

Both app interfaces ask you to choose a **white or black presentation background** before scanning. Choose black for white or light transparent logos and white for dark logos. The choice applies to every PowerPoint slide and the HTML gallery logo tiles; original logo files keep their transparency. The CLI defaults to white for compatibility; pass `--background black` to change it.

Open `output/premier-padel/index.html` to review the results. Records marked `Review name` came from a linked domain or asset filename rather than explicit page text. Confirm those names before publishing the deck.

## Streamlit and GitHub deployment

Run the cloud interface locally from the repository root:

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```

To deploy on Streamlit Community Cloud:

1. Push this folder to a GitHub repository.
2. Connect that GitHub account at `https://share.streamlit.io`.
3. Create an app using the repository, the `main` branch, and `streamlit_app.py` as the entrypoint.
4. Select Python 3.12 in Advanced settings and deploy.

Community Cloud reads `requirements.txt` for Streamlit and `packages.txt` for Chromium, Node.js, npm, and the virtual display used by difficult sites. The app installs the public Node packages on first startup and caches them for the running instance. The cloud interface exports the original-logo ZIP, PowerPoint, HTML report, CSV, and JSON.

The workflow in `.github/workflows/tests.yml` runs the browser, JavaScript, and Python checks on every push and pull request.

## Python and HTML interface

After the Node setup above, launch the local Python interface. The Python server has no third-party package requirements.

```bash
python3 app.py
```

Open `http://127.0.0.1:8787`, enter a website, and download the generated HTML gallery, PowerPoint, ZIP, CSV, or JSON. Python manages local jobs and downloads; the hardened crawler remains in `src/`, and the interface source is `web/index.html`.

Useful options:

```text
--max-pages 25    Increase the bounded internal-page crawl
--site-timeout 180  Limit time spent rendering one website (seconds)
--background black  Use black slides and logo tiles (white is also supported)
--overrides FILE  Apply reviewed names by SHA-256, source URL, or detected name
--headed          Show the browser while it works
--no-pptx         Skip PowerPoint creation
--no-zip          Skip ZIP packaging
--ignore-robots   Ignore robots.txt only when you have permission to crawl
```

## How detection works

The extractor searches regular and deferred images, inline SVG, embedded image objects, responsive `srcset` assets, data images, and CSS backgrounds. It recognizes English and Indonesian commercial labels such as partners, official sponsors, supported by, `mitra`, and `sponsor utama`. Logos must belong to a sponsor/partner-marked container or a list immediately following a recognized commercial label. Genuine sponsor lists inside footers remain eligible. Generic footer images, owner marks, app badges, navigation, article images, and nearby unrelated sections are excluded; a filename or federation label alone is insufficient evidence. Labels above sibling carousels and deferred or hidden carousel images remain supported. Unlabeled or unusually structured sponsor lists may require a dedicated page or future extraction rules.

The crawler uses a standard browser identity, follows `www` redirects as the same site, prioritizes discovered partnership and marketing links, and checks additional conventional paths. Streamlit runs Chromium through a virtual display, which helps sites that reject headless browsers. If Cloudflare or a broken client application still blocks access, the report records that limitation. It does not attempt to bypass the site's security controls.

Each record keeps the page URL, original asset URL, nearby heading, link target, naming method, confidence, and review status. Duplicate website assets are identified by SHA-256, even when the same carousel image has inconsistent labels. The original file remains unchanged while a PNG preview is generated separately.

For repeatable human review, pass a JSON object to `--overrides`. Keys can be a logo SHA-256, its source URL, or its detected name. Values may set `name`, `relationship`, `reviewRequired`, and `confidence`; `{ "ignore": true }` removes a false positive. See `examples/premier-padel-overrides.json`.

## Coverage model

No crawler can promise every commercial relationship from one arbitrary website. A sponsor may appear only in video, a blocked consent state, an image with no metadata, an unlinked page, or a third-party widget. Brand Atlas reports a bounded or partial crawl and lists failures instead of presenting incomplete output as exhaustive.

For deeper coverage, raise `--max-pages`, provide the most relevant landing page, and inspect records marked for review. OCR or vision recognition can be added as a separate review stage for image-only logos, but it should never silently replace website evidence.

## Security and operational design

Input and redirects accept only HTTP or HTTPS on ports 80 and 443. The downloader blocks local, private, link-local, multicast, and reserved IP ranges, limits response size and redirects, pins each request to a checked DNS answer, and enforces timeouts. Browser requests are checked before loading. The crawler respects robots.txt by default and stays on the supplied origin.

Website text is treated only as content. It never becomes an instruction to the program. Logos and brand names can be protected by trademark or copyright, so use the collected files for analysis and authorized presentations under the website's applicable terms.

## Development

```bash
npm test
pip install -r requirements.txt
python3 -m unittest discover -s tests -p 'test_*.py'
```

The code is split into `network.mjs` for safe fetching, `extract.mjs` for evidence capture, `cli.mjs` for crawling and asset normalization, and `export.mjs` for reporting.

## Sports catalog and batch scanning

The app includes **72 events, leagues and tours across 14 sports** in `data/sports-events.json`. The catalog is a starting list of official public websites, not a promise that every sponsor list is accessible. The deployed interface has an event picker, a searchable catalog with the last recorded check, and batch scans of up to 12 events. A custom URL remains available.

```bash
# All catalog websites: evidence, original logos, PNG previews, HTML, JSON and CSV per event
npm run batch -- --output output/sports-batch --concurrency 2 --max-pages 3

# A focused batch, with PowerPoint for each selected event
npm run batch -- --ids indian-premier-league,premier-padel --pptx --background black
```

The batch output includes `coverage.csv`, `coverage.json` and `coverage.md`. Every site has a separate outcome and output folder. Reports are checkpointed after each site so a partial run can be reviewed. Batch scans use the same crawler, extractor and downloader as single-site scans. Cloud batch downloads contain portable reports; use a single scan for the complete original-logo ZIP and PowerPoint. The command-line batch preserves original logos for every event.

The **Live sports website validation** GitHub Actions workflow can be run manually for the entire catalog or selected IDs. It uploads the resulting evidence and reports as a seven-day artifact. Live scans do not run on every push: ordinary CI uses deterministic fixtures and app interaction tests.

See [`docs/sports-validation.md`](docs/sports-validation.md) and [`data/validation-summary.json`](data/validation-summary.json) for the recorded live-check results. These are dated observations and do not update automatically.

## Extraction and failure handling

- Rendered pages, bounded scrolling, lazy image attributes, responsive images and picture sources.
- Labeled sponsor sections, recognized container markers and dedicated partner directories.
- English, French, Spanish, German, Indonesian, Japanese and Chinese section labels.
- Inline SVG, local SVG symbol references, image objects, CSS backgrounds and cropped sprite-sheet logos.
- Open shadow DOM and loaded same-site iframe sections; closed shadow roots and third-party widgets are not guaranteed.
- Original assets plus valid PNG previews; generic metadata and unknown names are marked for review instead of trusted blindly.
- Duplicate logo downloads are avoided; separate sprite crops and unnamed logos retain their own identity.
- Transient requests get bounded retries. Blocks and rate limits do not trigger repeated probing. Robots rules, including per-agent groups and crawl delays, are respected.
- Per-site and per-download budgets, limited workers, image size limits, bounded decompression, temporary-folder cleanup and subprocess-group termination.
- Invalid HTML responses and tracking pixels are rejected as logos. Missing downloads retain their evidence with an `unavailable` status. Optional PowerPoint failure preserves the other reports.

Outcomes include `found`, `no_evidence`, `assets_unavailable`, `blocked`, `rate_limited`, `robots_disallowed`, `robots_unavailable`, `parked_domain`, `timeout`, and network/browser failures. `found` means at least one logo was saved, **not** that all sponsors were found or every name was verified. A website can still require human review, a more specific sponsor page, or a future extraction rule. The tool does not bypass CAPTCHAs, access controls or robots restrictions.
