import unittest

from tools import loader


class ManifestLoaderTest(unittest.TestCase):
    def test_load_manifest(self):
        registry = loader.load_manifest()
        self.assertIsInstance(registry, dict)
        self.assertIn("system_packet_validator", registry)

    def test_validate_manifest_raises_on_bad(self):
        with self.assertRaises(Exception):
            loader.validate_manifest("/nonexistent/manifest.json")


if __name__ == "__main__":
    unittest.main()
