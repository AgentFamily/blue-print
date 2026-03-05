import unittest

from tools.system_packet_validator import main as validator


class SystemPacketValidatorTest(unittest.TestCase):
    def test_extract_from_fence(self):
        text = 'Some text\n```json\n{"SYSTEM_PACKET": {"manager": "m","agents": {"AgentC": {"role": "execute"}, "AgentX": {"role": "research_verify"}}, "tools": {"available": [], "recommended": []}, "next_actions": {}}}\n```\n'
        res = validator.run({"text": text})
        self.assertTrue(res["is_valid"], res)

    def test_extract_raw_json(self):
        text = 'prefix {"SYSTEM_PACKET": {"manager": "m","agents": {"AgentC": {"role": "execute"}, "AgentX": {"role": "research_verify"}}, "tools": {"available": [], "recommended": []}, "next_actions": {}}} suffix'
        res = validator.run({"text": text})
        self.assertTrue(res["is_valid"], res)

    def test_missing_keys(self):
        text = '```json\n{"SYSTEM_PACKET": {"agents": {}}}\n```'
        res = validator.run({"text": text})
        self.assertFalse(res["is_valid"])
        self.assertTrue(len(res["errors"]) > 0)


if __name__ == "__main__":
    unittest.main()
