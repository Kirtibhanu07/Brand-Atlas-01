"""Brand Atlas Streamlit Community Cloud entrypoint."""

from __future__ import annotations

import csv
from io import StringIO
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile
from io import BytesIO
from scan_runner import collect_reports, run_process
from urllib.parse import urlsplit

import streamlit as st

ROOT = Path(__file__).resolve().parent


def node_module_works(node: str, module: str) -> bool:
    probe = subprocess.run(
        [node, "-e", f"require('{module}')"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    return probe.returncode == 0


def valid_website(value: str) -> str:
    value = (value or "").strip()
    if value and "://" not in value:
        value = "https://" + value
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Enter a complete public http:// or https:// URL.")
    if parsed.username or parsed.password:
        raise ValueError("URLs containing credentials are not accepted.")
    if parsed.port and parsed.port not in {80, 443}:
        raise ValueError("Only standard ports 80 and 443 are accepted.")
    return value


@st.cache_resource(show_spinner="Preparing the website scanner…")
def prepare_node() -> str:
    node = shutil.which("node")
    npm = shutil.which("npm")
    if not node or not npm:
        raise RuntimeError("Node.js and npm were not installed. Check packages.txt in the deployment logs.")
    modules = ROOT / "node_modules"
    if (
        not modules.exists()
        or not (modules / "playwright").exists()
        or not node_module_works(node, "sharp")
        or not node_module_works(node, "pptxgenjs")
    ):
        completed = subprocess.run(
            [
                npm,
                "install",
                "--omit=dev",
                "--include=optional",
                "--no-audit",
                "--no-fund",
            ],
            cwd=ROOT, capture_output=True, text=True, timeout=8 * 60, check=False,
            env={**os.environ, "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1"},
        )
        if completed.returncode:
            raise RuntimeError("npm dependency installation failed:\n" + completed.stderr[-3000:])
    if not node_module_works(node, "sharp"):
        raise RuntimeError(
            "Sharp's platform binary is unavailable after npm install. "
            "Check that optional npm dependencies are enabled in the deployment logs."
        )
    if not node_module_works(node, "pptxgenjs"):
        raise RuntimeError("The PowerPoint export dependency is unavailable after npm install.")
    return node


def scan_environment() -> dict:
    environment = {**os.environ, "BRAND_ATLAS_PPTX_ENGINE": "portable"}
    for candidate in ("/usr/bin/chromium", "/usr/bin/chromium-browser"):
        if Path(candidate).exists():
            environment["CHROMIUM_PATH"] = candidate
            break
    return environment


def run_scan(website: str, max_pages: int, background: str = "white") -> tuple[dict, dict[str, bytes]]:
    if background not in ("white", "black"):
        raise ValueError("Background must be white or black")
    node = prepare_node()
    with tempfile.TemporaryDirectory(prefix="brand-atlas-") as temporary:
        run_dir = Path(temporary)
        command = [node, str(ROOT / "src" / "cli.mjs"), website, "--output", str(run_dir),
                   "--max-pages", str(max_pages), "--background", background, "--site-timeout", "180"]
        xvfb = shutil.which("xvfb-run")
        if xvfb:
            command = [xvfb, "-a", *command, "--headed"]
        if urlsplit(website).hostname in {"premierpadel.com", "www.premierpadel.com"}:
            command.extend(["--overrides", str(ROOT / "examples" / "premier-padel-overrides.json")])
        completed = run_process(command, cwd=ROOT, env=scan_environment(), timeout=6 * 60)
        if completed.returncode:
            raise RuntimeError((completed.stdout + "\n" + completed.stderr).strip()[-3000:])
        files = collect_reports(run_dir)
        return json.loads(files["brands.json"]), files


def run_batch_scan(event_ids: list[str], background: str) -> tuple[dict, bytes]:
    catalog = json.loads((ROOT / "data" / "sports-events.json").read_text())
    valid_ids = {event["id"] for event in catalog}
    if not event_ids or len(event_ids) > 12 or any(event not in valid_ids for event in event_ids):
        raise ValueError("Choose between 1 and 12 catalog events per batch.")
    if background not in ("white", "black"):
        raise ValueError("Background must be white or black")
    node = prepare_node()
    with tempfile.TemporaryDirectory(prefix="brand-atlas-batch-") as temporary:
        run_dir = Path(temporary)
        command = [node, str(ROOT / "src" / "batch.mjs"), "--ids", ",".join(event_ids),
                   "--output", str(run_dir), "--concurrency", "2", "--max-pages", "3", "--background", background]
        if shutil.which("xvfb-run"):
            command = [shutil.which("xvfb-run"), "-a", *command, "--headed"]
        completed = run_process(command, cwd=ROOT, env=scan_environment(), timeout=20 * 60)
        if completed.returncode:
            raise RuntimeError((completed.stdout + "\n" + completed.stderr).strip()[-3000:])
        summary = json.loads((run_dir / "coverage.json").read_text())
        # Batch download contains portable reports. Full original assets remain in CLI output;
        # use a single scan to download one event's complete original-logo package.
        archive = BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for file in run_dir.rglob("*"):
                if file.is_file() and file.suffix in {".html", ".json", ".csv", ".md"}:
                    bundle.write(file, file.relative_to(run_dir))
        return summary, archive.getvalue()


def as_csv_rows(data: bytes) -> list[dict[str, str]]:
    return list(csv.DictReader(StringIO(data.decode("utf-8"))))


st.set_page_config(page_title="Brand Atlas", page_icon="🔎", layout="wide")
st.markdown("""
<style>
div[data-testid="stAppViewContainer"]{background:#f6f3ec}
.hero{padding:2.2rem 0 1rem;border-bottom:1px solid #ded8ca;margin-bottom:1.5rem}
.eyebrow{color:#9b6d25;letter-spacing:.16em;font-size:.72rem;font-weight:800}
.hero h1{font-size:4.4rem;line-height:.95;margin:.5rem 0 1rem;color:#111827}
.hero p{font-size:1.05rem;color:#667085;max-width:760px}
.coverage{padding:.9rem 1rem;background:#fff;border-left:4px solid #c89b4b;margin:1rem 0}
</style>
<section class="hero"><span class="eyebrow">WEBSITE EVIDENCE TOOL</span><h1>Brand Atlas</h1><p>Collect sponsor and partner logos from a rendered website. Download the original assets, a searchable HTML report, CSV, JSON, and a portable ZIP.</p></section>
""", unsafe_allow_html=True)

catalog = json.loads((ROOT / "data" / "sports-events.json").read_text("utf-8"))
validation_path = ROOT / "data" / "validation-summary.json"
validation = json.loads(validation_path.read_text()) if validation_path.is_file() else {"results": []}
last_check = {row["id"]: row for row in validation["results"]}
event_by_name = {event["name"]: event for event in catalog}
scan_tab, batch_tab, catalog_tab = st.tabs(["Website scan", "Batch scan", f"{len(catalog)} sports events"])

with scan_tab:
    selected = st.selectbox("Choose an event, league or tour", ["Custom website", *event_by_name],
                            index=1 + list(event_by_name).index("Premier Padel"))
    preset = event_by_name.get(selected, {})
    with st.form("scan"):
        left, right = st.columns([4, 1])
        website = left.text_input("Website URL", value=preset.get("url", ""), key=f"website_{preset.get('id', 'custom')}")
        max_pages = right.number_input("Maximum pages", min_value=1, max_value=30, value=8)
        background = st.radio("Presentation background", ["white", "black"], horizontal=True,
                              format_func=str.title, index=1,
                              help="Choose black for white or light transparent logos, or white for dark logos.")
        submitted = st.form_submit_button("Collect brands and logos", type="primary", width="stretch")

with batch_tab:
    st.write("Check up to 12 events together. Each site gets its own result, even if another site is blocked. Batch downloads include HTML, CSV and JSON reports; use Website scan for PowerPoint and the original-logo ZIP.")
    with st.form("batch"):
        selected_events = st.multiselect("Events to scan", list(event_by_name), max_selections=12)
        batch_background = st.radio("Logo background", ["black", "white"], format_func=str.title, horizontal=True)
        batch_submitted = st.form_submit_button("Scan selected events", type="primary")
    if batch_submitted:
        try:
            with st.spinner("Checking each event and saving separate evidence reports…"):
                st.session_state["batch_result"] = run_batch_scan([event_by_name[name]["id"] for name in selected_events], batch_background)
        except Exception as exc:
            st.error(str(exc))
    if "batch_result" in st.session_state:
        summary, archive = st.session_state["batch_result"]
        st.write(f"{summary['checked']} of {summary['total']} events checked")
        st.dataframe([{key: row.get(key) for key in ("name", "sport", "outcome", "brands", "downloadedLogos", "unavailableLogos")} for row in summary["results"]], hide_index=True, width="stretch")
        st.download_button("Download batch reports", archive, "brand-atlas-batch.zip", "application/zip")

with catalog_tab:
    st.write("A starting catalog of public event, league and tour websites. Sponsor coverage and access rules vary; a listing does not guarantee extraction support.")
    sport_filter = st.selectbox("Filter by sport", ["All sports", *sorted({event["sport"] for event in catalog})])
    query = st.text_input("Search sports events")
    st.caption(f"Last catalog validation: {validation.get('finishedAt', 'not yet run')}. A saved-logo result is not a complete sponsor inventory.")
    rows = [{"Event": event["name"], "Sport": event["sport"], "Type": event["kind"], "Website": event["url"], "Last check": last_check.get(event["id"], {}).get("outcome", "not checked"), "Saved logos": last_check.get(event["id"], {}).get("downloadedLogos", 0)} for event in catalog
            if (sport_filter == "All sports" or event["sport"] == sport_filter) and query.casefold() in event["name"].casefold()]
    st.dataframe(rows, hide_index=True, width="stretch",
                 column_config={"Website": st.column_config.LinkColumn("Website")})
    st.download_button("Download all event websites", json.dumps(catalog, indent=2), "sports-events.json", "application/json")

if submitted:
    try:
        website = valid_website(website)
        with st.spinner("Rendering pages, finding brand sections, and preserving logo files…"):
            manifest, files = run_scan(website, int(max_pages), background)
        st.session_state["result"] = (manifest, files)
    except Exception as exc:
        st.error(str(exc))

if "result" in st.session_state:
    manifest, files = st.session_state["result"]
    coverage = manifest.get("coverage", {})
    st.caption(f"Result: {coverage.get('outcome', 'unknown')} · Downloadable logos for {coverage.get('brandsWithDownloadedLogos', 0)} brands")
    st.markdown(
        f'<div class="coverage"><b>{len(manifest.get("brands", []))} brand records</b> across '
        f'{coverage.get("pagesVisited", 0)} rendered pages. Coverage: {coverage.get("status", "unknown")}.</div>',
        unsafe_allow_html=True,
    )
    buttons = st.columns(5)
    buttons[0].download_button("Download complete ZIP", files["brand-atlas.zip"], "brand-atlas.zip", "application/zip", width="stretch")
    buttons[1].download_button("Download PowerPoint", files.get("brand-atlas.pptx", b""), "brand-atlas.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", disabled="brand-atlas.pptx" not in files, width="stretch")
    buttons[2].download_button("Download CSV", files["brands.csv"], "brands.csv", "text/csv", width="stretch")
    buttons[3].download_button("Download JSON", files["brands.json"], "brands.json", "application/json", width="stretch")
    buttons[4].download_button("Download HTML report", files["index.html"], "brand-report.html", "text/html", width="stretch")
    rows = as_csv_rows(files["brands.csv"])
    st.dataframe(rows, width="stretch", hide_index=True)
    if coverage.get("warnings"):
        with st.expander("Coverage notes"):
            for warning in coverage["warnings"]:
                st.write("•", warning)
