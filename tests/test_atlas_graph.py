import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "atlas_graph.py"
GRAPH = ROOT / "atlas.graph.json"


class AtlasGraphTest(unittest.TestCase):
    def test_validate_graph(self):
        res = subprocess.run(
            [sys.executable, str(SCRIPT), "--path", str(GRAPH), "validate"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(
            res.returncode,
            0,
            msg=f"validate failed:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}",
        )
        self.assertIn("OK: graph is valid", res.stdout)

    def test_list_graph(self):
        res = subprocess.run(
            [sys.executable, str(SCRIPT), "--path", str(GRAPH), "list"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(
            res.returncode,
            0,
            msg=f"list failed:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}",
        )
        self.assertIn("Nodes (", res.stdout)
        self.assertIn("Routes (", res.stdout)


if __name__ == "__main__":
    unittest.main()
