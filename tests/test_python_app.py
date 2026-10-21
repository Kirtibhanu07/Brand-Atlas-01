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

    def test_output_path_cannot_escape_run(self):
        with self.assertRaises(ValueError):
            safe_run_file("abc", "../../README.md")


if __name__ == "__main__":
    unittest.main()
