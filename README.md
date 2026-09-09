# Brand Atlas

Brand Atlas accepts one public website URL and builds a reviewable inventory of the brands, sponsors, partners, organizers, and governing bodies displayed by that website. It uses the rendered page, so it can see logos loaded by JavaScript and lazy loading.

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

Community Cloud reads `requirements.txt` for Streamlit and `packages.txt` for Chromium, Node.js, and npm. The app installs the public Node packages on first startup and caches them for the running instance. The cloud interface exports the original-logo ZIP, HTML report, CSV, and JSON. The local CLI also exports PowerPoint when the optional Artifact Tool package is available.

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
--overrides FILE  Apply reviewed names by SHA-256, source URL, or detected name
--headed          Show the browser while it works
--no-pptx         Skip PowerPoint creation
--no-zip          Skip ZIP packaging
--ignore-robots   Ignore robots.txt only when you have permission to crawl
```

## How detection works

The extractor searches visible images, inline SVG, and CSS background images inside sections whose headings or markup indicate partners, sponsors, suppliers, clients, organizers, associations, or federations. It also reads relevant logos in page footers. Social icons, navigation controls, flags, article thumbnails, and other common non-brand assets are removed.

Each record keeps the page URL, original asset URL, nearby heading, link target, naming method, confidence, and review status. Duplicate website assets are identified by SHA-256. The original file remains unchanged while a PNG preview is generated separately.

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
