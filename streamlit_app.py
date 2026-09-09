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
from urllib.parse import urlsplit

import streamlit as st

ROOT = Path(__file__).resolve().parent


def valid_website(value: str) -> str:
    value = (value or "").strip()
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
    if not modules.exists() or not (modules / "playwright").exists():
        completed = subprocess.run(
            [npm, "install", "--omit=optional", "--no-audit", "--no-fund"],
            cwd=ROOT, capture_output=True, text=True, timeout=8 * 60, check=False,
            env={**os.environ, "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1"},
        )
        if completed.returncode:
            raise RuntimeError("npm dependency installation failed:\n" + completed.stderr[-3000:])
    return node


def run_scan(website: str, max_pages: int) -> tuple[dict, dict[str, bytes]]:
    node = prepare_node()
    run_dir = Path(tempfile.mkdtemp(prefix="brand-atlas-"))
    command = [node, str(ROOT / "src" / "cli.mjs"), website, "--output", str(run_dir),
               "--max-pages", str(max_pages), "--no-pptx"]
    if urlsplit(website).hostname in {"premierpadel.com", "www.premierpadel.com"}:
        command.extend(["--overrides", str(ROOT / "examples" / "premier-padel-overrides.json")])
    environment = {**os.environ}
    for candidate in ("/usr/bin/chromium", "/usr/bin/chromium-browser"):
        if Path(candidate).exists():
            environment["CHROMIUM_PATH"] = candidate
            break
    completed = subprocess.run(
        command, cwd=ROOT, capture_output=True, text=True, timeout=15 * 60,
        check=False, env=environment,
    )
    if completed.returncode:
        raise RuntimeError((completed.stdout + "\n" + completed.stderr).strip()[-5000:])
    names = ["brand-atlas.zip", "brands.csv", "brands.json", "index.html"]
    files = {name: (run_dir / name).read_bytes() for name in names}
    manifest = json.loads(files["brands.json"])
    return manifest, files


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

with st.form("scan"):
    left, right = st.columns([4, 1])
    website = left.text_input("Website URL", value="https://premierpadel.com/en/home-page")
    max_pages = right.number_input("Maximum pages", min_value=1, max_value=30, value=12)
    submitted = st.form_submit_button("Collect brands and logos", type="primary", use_container_width=True)

if submitted:
    try:
        website = valid_website(website)
        with st.spinner("Rendering pages, finding brand sections, and preserving logo files…"):
            manifest, files = run_scan(website, int(max_pages))
        st.session_state["result"] = (manifest, files)
    except Exception as exc:
        st.error(str(exc))

if "result" in st.session_state:
    manifest, files = st.session_state["result"]
    coverage = manifest.get("coverage", {})
    st.markdown(
        f'<div class="coverage"><b>{len(manifest.get("brands", []))} brand records</b> across '
        f'{coverage.get("pagesVisited", 0)} rendered pages. Coverage: {coverage.get("status", "unknown")}.</div>',
        unsafe_allow_html=True,
    )
    buttons = st.columns(4)
    buttons[0].download_button("Download complete ZIP", files["brand-atlas.zip"], "brand-atlas.zip", "application/zip", use_container_width=True)
    buttons[1].download_button("Download CSV", files["brands.csv"], "brands.csv", "text/csv", use_container_width=True)
    buttons[2].download_button("Download JSON", files["brands.json"], "brands.json", "application/json", use_container_width=True)
    buttons[3].download_button("Download HTML report", files["index.html"], "brand-report.html", "text/html", use_container_width=True)
    rows = as_csv_rows(files["brands.csv"])
    st.dataframe(rows, use_container_width=True, hide_index=True)
    if coverage.get("warnings"):
        with st.expander("Coverage notes"):
            for warning in coverage["warnings"]:
                st.write("•", warning)
