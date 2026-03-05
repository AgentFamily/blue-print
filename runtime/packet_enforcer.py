"""Enforce SYSTEM_PACKET presence and correctness by validating and regenerating responses."""
from __future__ import annotations

from typing import Callable

from tools import runner


class PacketEnforcerError(Exception):
    pass


def enforce_or_regenerate(generate_fn: Callable[[str], str], user_msg: str, max_retries: int = 2) -> str:
    """Call generate_fn to obtain assistant text and ensure it contains a valid SYSTEM_PACKET.

    If invalid, request regeneration up to max_retries times. Returns final valid assistant text.
    Raises PacketEnforcerError if unsuccessful.
    """
    attempt = 0
    last_errors = None
    while True:
        assistant_text = generate_fn(user_msg)
        res = runner.run_tool("system_packet_validator", {"text": assistant_text})
        if res.get("is_valid"):
            return assistant_text
        last_errors = res
        attempt += 1
        if attempt > max_retries:
            raise PacketEnforcerError(f"Failed to obtain valid SYSTEM_PACKET after {attempt} attempts: {res}")
        # Build regeneration instruction
        instr = user_msg + "\n\n--REGENERATION INSTRUCTIONS--\nThe previous assistant output failed SYSTEM_PACKET validation with errors:\n"
        for e in res.get("errors", []):
            instr += f"- {e}\n"
        instr += "\nReturn a corrected response containing a valid SYSTEM_PACKET JSON."
        # Next generate call will include instructions appended
        user_msg = instr
