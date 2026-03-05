"""Simple deterministic tool recommender based on user message keywords."""
from __future__ import annotations

from typing import Dict, List


def recommend_tools(user_msg: str, registry: Dict[str, Dict]) -> Dict[str, object]:
    text = user_msg.lower()
    recommended: List[str] = []
    reason: Dict[str, str] = {}
    # Heuristics
    build_keywords = ("build", "implement", "code", "repo")
    verify_keywords = ("verify", "latest", "research", "check")
    for name in registry:
        lname = name.lower()
        if any(k in text for k in build_keywords) and ("container" in lname or "build" in lname or "exec" in lname):
            recommended.append(name)
            reason[name] = "Matches build/implement intent"
        if any(k in text for k in verify_keywords) and ("verify" in lname or "validate" in lname or "system_packet" in lname):
            if name not in recommended:
                recommended.append(name)
                reason[name] = "Matches verify/research intent"
    # deterministic fallback: include system_packet_validator if present
    if "system_packet_validator" in registry and "system_packet_validator" not in recommended:
        recommended.append("system_packet_validator")
        reason["system_packet_validator"] = "Always recommended for SYSTEM_PACKET enforcement"
    return {"recommended": recommended, "why": reason}
def recommend_tools(user_msg: str, registry: dict) -> dict:
    text = user_msg.lower()
    recommended = []
    reason = {}
    build_keywords = ("build", "implement", "code", "repo")
    verify_keywords = ("verify", "latest", "research", "check")
    for name in registry:
        lname = name.lower()
        if any(k in text for k in build_keywords) and ("container" in lname or "build" in lname or "exec" in lname):
            recommended.append(name)
            reason[name] = "Matches build/implement intent"
        if any(k in text for k in verify_keywords) and ("verify" in lname or "validate" in lname or "system_packet" in lname):
            if name not in recommended:
                recommended.append(name)
                reason[name] = "Matches verify/research intent"
    if "system_packet_validator" in registry and "system_packet_validator" not in recommended:
        recommended.append("system_packet_validator")
        reason["system_packet_validator"] = "Always recommended for SYSTEM_PACKET enforcement"
    return {"recommended": recommended, "why": reason}
