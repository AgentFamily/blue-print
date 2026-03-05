"""Small CLI demonstrating generate_fn wiring and packet enforcer."""
from __future__ import annotations

import json
import sys

from tools import loader
from runtime import tool_recommender, packet_enforcer


def generate_fn_stub(user_msg: str) -> str:
    """Stubbed generator. If regeneration instructions are present, return a corrected valid packet.

    Otherwise return a basic assistant response with SYSTEM_PACKET populated.
    """
    registry = loader.load_manifest()
    rec = tool_recommender.recommend_tools(user_msg, registry)
    packet = {
        "manager": "local-llm-manager",
        "agents": {"AgentC": {"role": "execute"}, "AgentX": {"role": "research_verify"}},
        "tools": {"available": list(registry.keys()), "recommended": rec["recommended"]},
        "next_actions": {"note": "Proceed with care"},
    }
    body = "Assistant reply body."
    sys_packet = json.dumps({"SYSTEM_PACKET": packet})
    # Always return fenced JSON
    return f"{body}\n```json\n{sys_packet}\n```"


def main():
    if len(sys.argv) > 1:
        user_msg = " ".join(sys.argv[1:])
    else:
        user_msg = input("User message: ")
    registry = loader.load_manifest()
    print("Loaded tools:", list(registry.keys()))
    try:
        assistant_text = packet_enforcer.enforce_or_regenerate(generate_fn_stub, user_msg)
        print("Assistant output:\n")
        print(assistant_text)
    except Exception as e:
        print(f"Failed: {e}")


if __name__ == "__main__":
    main()
import json
from tools import loader
from runtime import tool_recommender, packet_enforcer


def generate_fn_stub(user_msg: str) -> str:
    registry = loader.load_manifest()
    rec = tool_recommender.recommend_tools(user_msg, registry)
    packet = {
        "manager": "local-llm-manager",
        "agents": {"AgentC": {"role": "execute"}, "AgentX": {"role": "research_verify"}},
        "tools": {"available": list(registry.keys()), "recommended": rec["recommended"]},
        "next_actions": {"note": "Proceed with care"},
    }
    body = "Assistant reply body."
    sys_packet = json.dumps({"SYSTEM_PACKET": packet})
    return f"{body}\n```json\n{sys_packet}\n```"


def main():
    import sys

    if len(sys.argv) > 1:
        user_msg = " ".join(sys.argv[1:])
    else:
        user_msg = input("User message: ")
    registry = loader.load_manifest()
    print("Loaded tools:", list(registry.keys()))
    try:
        assistant_text = packet_enforcer.enforce_or_regenerate(generate_fn_stub, user_msg)
        print("Assistant output:\n")
        print(assistant_text)
    except Exception as e:
        print(f"Failed: {e}")


if __name__ == "__main__":
    main()
