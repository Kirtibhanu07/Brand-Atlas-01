"""App-level interaction checks; no external scan is needed to test the controls."""
import importlib.util
from pathlib import Path
import unittest


@unittest.skipUnless(importlib.util.find_spec("streamlit"), "Install requirements.txt to run Streamlit checks")
class StreamlitInterfaceTests(unittest.TestCase):
    def app(self):
        from streamlit.testing.v1 import AppTest
        return AppTest.from_file(str(Path(__file__).resolve().parents[1] / "streamlit_app.py")).run(timeout=20)

    def test_event_picker_updates_url_and_has_all_catalog_entries(self):
        app = self.app()
        self.assertEqual(len(app.exception), 0)
        self.assertGreaterEqual(len(app.selectbox[0].options), 51)
        app.selectbox[0].select("Wimbledon").run()
        self.assertEqual(len(app.exception), 0)
        self.assertEqual(app.text_input[0].value, "https://www.wimbledon.com/")
        self.assertEqual(app.radio[0].value, "black")

    def test_catalog_filter_and_empty_batch_are_controlled(self):
        app = self.app()
        app.selectbox[1].select("Tennis").run()
        rows = app.dataframe[0].value
        self.assertTrue(all(row == "Tennis" for row in rows["Sport"]))
        app.button[1].click().run()
        self.assertEqual(len(app.exception), 0)
        self.assertIn("Choose between 1 and 12", app.error[0].value)


if __name__ == "__main__":
    unittest.main()
