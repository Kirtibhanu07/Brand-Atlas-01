"""Bounded subprocess execution and report collection shared by the web interfaces."""
from __future__ import annotations
import os
from pathlib import Path
import signal
import subprocess

REPORT_NAMES = ("brand-atlas.zip", "brand-atlas.pptx", "brands.csv", "brands.json", "index.html")

def run_process(command: list[str], *, cwd: Path, env: dict, timeout: int) -> subprocess.CompletedProcess:
    process = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        if os.name == "posix":
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            process.kill()
        process.communicate()
        raise RuntimeError("The scan reached its time limit. Try fewer pages or a smaller batch.") from None
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def collect_reports(directory: Path) -> dict[str, bytes]:
    files = {name: (directory / name).read_bytes() for name in REPORT_NAMES if (directory / name).is_file()}
    if "brands.json" not in files:
        raise RuntimeError("The scanner did not produce a report. Please retry with the event's public sponsor page.")
    return files
