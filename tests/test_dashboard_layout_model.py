import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NODE_TEST = ROOT / "tests" / "dashboard_layout_model.test.js"


class DashboardLayoutModelTest(unittest.TestCase):
    def test_node_layout_model(self):
        res = subprocess.run(
            ["node", "--test", str(NODE_TEST)],
            capture_output=True,
            text=True,
            check=False,
            cwd=str(ROOT),
        )
        self.assertEqual(
            res.returncode,
            0,
            msg=f"Node layout model tests failed\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
