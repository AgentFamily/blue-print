import unittest

from runtime import packet_enforcer


class PacketEnforcerTest(unittest.TestCase):
    def test_retries_and_succeeds(self):
        calls = {"n": 0}

        def gen(user_msg: str) -> str:
            calls["n"] += 1
            if calls["n"] == 1:
                return "No packet here"
            return (
                'Body text\n```json\n{"SYSTEM_PACKET": {"manager": "m","agents": {"AgentC": {"role": "execute"}, "AgentX": {"role": "research_verify"}}, "tools": {"available": [], "recommended": []}, "next_actions": {}}}\n```'
            )

        out = packet_enforcer.enforce_or_regenerate(gen, "please do this")
        self.assertIn("SYSTEM_PACKET", out)
        self.assertEqual(calls["n"], 2)


if __name__ == "__main__":
    unittest.main()
