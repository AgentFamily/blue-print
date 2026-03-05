import unittest

from tools import runner


class RunnerTest(unittest.TestCase):
    def test_unknown_tool(self):
        with self.assertRaises(Exception):
            runner.run_tool("no_such_tool", {})


if __name__ == "__main__":
    unittest.main()
