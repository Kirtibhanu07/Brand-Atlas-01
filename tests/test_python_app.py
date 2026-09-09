import unittest
from app import safe_run_file, validate_website


class PythonAppTests(unittest.TestCase):
    def test_url_boundary(self):
        self.assertEqual(validate_website("https://example.com/path"), "https://example.com/path")
        for value in ("file:///etc/passwd", "http://user:pass@example.com", "https://example.com:8443"):
            with self.assertRaises(ValueError):
                validate_website(value)

    def test_output_path_cannot_escape_run(self):
        with self.assertRaises(ValueError):
            safe_run_file("abc", "../../README.md")


if __name__ == "__main__":
    unittest.main()
