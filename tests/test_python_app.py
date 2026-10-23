import unittest
import json
from io import BytesIO
from unittest.mock import Mock, patch
from app import Handler, safe_run_file, validate_website


class PythonAppTests(unittest.TestCase):
    def test_url_boundary(self):
        self.assertEqual(validate_website("https://example.com/path"), "https://example.com/path")
        self.assertEqual(validate_website("example.com/path"), "https://example.com/path")
        for value in ("file:///etc/passwd", "http://user:pass@example.com", "https://example.com:8443"):
            with self.assertRaises(ValueError):
                validate_website(value)

    def test_background_passes_from_request_to_worker(self):
        for background in ("white", "black"):
            handler = Handler.__new__(Handler)
            body = json.dumps({"website": "https://example.com", "background": background}).encode()
            handler.path = "/api/runs"
            handler.headers = {"Content-Length": str(len(body))}
            handler.rfile = BytesIO(body)
            handler.json_response = Mock()
            with patch("app.threading.Thread") as worker:
                handler.do_POST()
                self.assertEqual(worker.call_args.kwargs["args"][-1], background)
                self.assertEqual(handler.json_response.call_args.args[0], 202)
                self.assertEqual(handler.json_response.call_args.args[1]["background"], background)

    def test_invalid_background_is_rejected(self):
        handler = Handler.__new__(Handler)
        body = json.dumps({"website": "https://example.com", "background": "red"}).encode()
        handler.path = "/api/runs"
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = BytesIO(body)
        handler.json_response = Mock()
        with patch("app.threading.Thread") as worker:
            handler.do_POST()
            worker.assert_not_called()
            self.assertEqual(handler.json_response.call_args.args[0], 400)

    def test_missing_runtime_marks_job_failed_instead_of_leaving_it_queued(self):
        import app
        job_id = "runtime-test"
        app.JOBS[job_id] = {"status": "queued"}
        try:
            with patch("app.node_executable", side_effect=RuntimeError("Node.js unavailable")):
                app.execute_job(job_id, "https://example.com", 1)
            self.assertEqual(app.JOBS[job_id]["status"], "failed")
        finally:
            app.JOBS.pop(job_id, None)

    def test_output_path_cannot_escape_run(self):
        with self.assertRaises(ValueError):
            safe_run_file("abc", "../../README.md")




class ScanRunnerTests(unittest.TestCase):
    def test_collect_reports_allows_missing_optional_powerpoint(self):
        from pathlib import Path
        import tempfile
        from scan_runner import collect_reports
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "brands.json").write_text('{"brands": []}')
            self.assertEqual(set(collect_reports(root)), {"brands.json"})

    def test_subprocess_timeout_is_controlled(self):
        from pathlib import Path
        import os
        import sys
        from scan_runner import run_process
        with self.assertRaisesRegex(RuntimeError, "time limit"):
            run_process([sys.executable, "-c", "import time; time.sleep(30)"],
                        cwd=Path.cwd(), env=dict(os.environ), timeout=0.1)

    def test_subprocess_captures_failures_without_a_shell(self):
        from pathlib import Path
        import os
        import sys
        from scan_runner import run_process
        result = run_process([sys.executable, "-c", "import sys; print('controlled failure', file=sys.stderr); sys.exit(7)"],
                             cwd=Path.cwd(), env=dict(os.environ), timeout=3)
        self.assertEqual(result.returncode, 7)
        self.assertIn("controlled failure", result.stderr)


if __name__ == "__main__":
    unittest.main()
