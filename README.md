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
python3 -m unittest tests/test_python_app.py
```

The code is split into `network.mjs` for safe fetching, `extract.mjs` for evidence capture, `cli.mjs` for crawling and asset normalization, and `export.mjs` for reporting.

## Sports website checks

`examples/sports-sites.json` lists BWF, AFC, SPL (interpreted as Saudi Pro League), Premier Padel, Hong Kong Sevens, Singapore Sevens, ICC and IPL. Run an optional live extraction check with:

```bash
node scripts/check-sports.mjs
# If needed: CHROMIUM_PATH=/path/to/chrome node scripts/check-sports.mjs
```

The check respects robots.txt, records page status, candidates and limitations in `output/sports-check.json`, and does not assert fixed sponsor counts. A blocked page or zero candidates is a coverage limitation, not proof that a website has no sponsors. Browser regression tests use stable fixtures covering genuine footer sponsor lists, unrelated footer assets, navigation links, neighboring news sections and hidden carousels.
