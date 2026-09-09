#!/usr/bin/env python3
"""Local Python web interface for Brand Atlas.

The Python server accepts jobs and invokes the hardened Node crawler with an
argument array. It never passes user input through a shell.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
from pathlib import Path
import shutil
import subprocess
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / "web"
RUN_ROOT = ROOT / "output" / "runs"
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
RUN_LIMIT = threading.Semaphore(2)


def validate_website(value: str) -> str:
    """Perform cheap API-boundary validation; the crawler performs DNS checks."""
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError("Website URL is missing or too long")
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Enter a complete http:// or https:// website URL")
    if parsed.username or parsed.password:
        raise ValueError("URLs containing credentials are not allowed")
    if parsed.port and parsed.port not in {80, 443}:
        raise ValueError("Only standard web ports 80 and 443 are allowed")
    return value.strip()


def safe_run_file(run_id: str, relative: str) -> Path:
    if not run_id or any(c not in "0123456789abcdef-" for c in run_id):
        raise ValueError("Invalid run identifier")
    base = (RUN_ROOT / run_id).resolve()
    target = (base / unquote(relative)).resolve()
    if target != base and base not in target.parents:
        raise ValueError("Invalid output path")
    return target


def node_executable() -> str:
    configured = os.environ.get("BRAND_ATLAS_NODE")
    found = configured or shutil.which("node")
    if not found:
        raise RuntimeError("Node.js 20 or newer is required")
    return found


def update_job(job_id: str, **changes) -> None:
    with JOBS_LOCK:
        JOBS[job_id].update(changes)


def execute_job(job_id: str, website: str, max_pages: int) -> None:
    output = RUN_ROOT / job_id
    command = [node_executable(), str(ROOT / "src" / "cli.mjs"), website,
               "--output", str(output), "--max-pages", str(max_pages)]
    with RUN_LIMIT:
        update_job(job_id, status="running")
        try:
            completed = subprocess.run(
                command, cwd=ROOT, capture_output=True, text=True,
                timeout=20 * 60, check=False,
                env={**os.environ, "NO_COLOR": "1"},
            )
            log = (completed.stdout + "\n" + completed.stderr).strip()[-8000:]
            if completed.returncode:
                update_job(job_id, status="failed", error=log or "Crawler failed")
                return
            manifest = json.loads((output / "brands.json").read_text("utf-8"))
            update_job(
                job_id, status="complete", log=log,
                brandCount=len(manifest.get("brands", [])),
                coverage=manifest.get("coverage", {}),
                files={
                    "gallery": f"/runs/{job_id}/index.html",
                    "powerpoint": f"/runs/{job_id}/brand-atlas.pptx",
                    "package": f"/runs/{job_id}/brand-atlas.zip",
                    "json": f"/runs/{job_id}/brands.json",
                    "csv": f"/runs/{job_id}/brands.csv",
                },
            )
        except Exception as exc:  # surfaced to the local UI, without traceback
            update_job(job_id, status="failed", error=str(exc))


class Handler(BaseHTTPRequestHandler):
    server_version = "BrandAtlas/1.0"

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:")
        super().end_headers()

    def json_response(self, status: int, value: dict) -> None:
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def file_response(self, file: Path) -> None:
        if not file.is_file():
            self.send_error(404)
            return
        data = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        route = urlsplit(self.path).path
        if route == "/":
            self.file_response(WEB_ROOT / "index.html")
            return
        if route.startswith("/api/runs/"):
            job_id = route.removeprefix("/api/runs/").strip("/")
            with JOBS_LOCK:
                job = JOBS.get(job_id)
            self.json_response(200, job) if job else self.json_response(404, {"error": "Run not found"})
            return
        if route.startswith("/runs/"):
            parts = route.split("/", 3)
            try:
                self.file_response(safe_run_file(parts[2], parts[3] if len(parts) > 3 else ""))
            except ValueError as exc:
                self.json_response(400, {"error": str(exc)})
            return
        self.send_error(404)

    def do_POST(self) -> None:  # noqa: N802
        if urlsplit(self.path).path != "/api/runs":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 2 or length > 65536:
                raise ValueError("Invalid request size")
            body = json.loads(self.rfile.read(length))
            website = validate_website(body.get("website", ""))
            max_pages = max(1, min(100, int(body.get("maxPages", 12))))
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self.json_response(400, {"error": str(exc)})
            return
        job_id = str(uuid.uuid4())
        job = {"id": job_id, "status": "queued", "website": website, "maxPages": max_pages}
        with JOBS_LOCK:
            JOBS[job_id] = job
        threading.Thread(target=execute_job, args=(job_id, website, max_pages), daemon=True).start()
        self.json_response(202, job)

    def log_message(self, message: str, *args) -> None:
        print(f"{self.address_string()} - {message % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local Brand Atlas web interface")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    RUN_ROOT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Brand Atlas is ready at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
