"""SYSTEM_PACKET extraction and validation tool.

Entry: tools.system_packet_validator.main:run
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional


def _extract_from_fence(text: str) -> Optional[str]:
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, flags=re.S)
    if m:
        return m.group(1)
    return None


def _extract_first_json_with_system_packet(text: str) -> Optional[str]:
    # naive brace matching: find '{', then walk to matching '}'
    for i, ch in enumerate(text):
        if ch == "{":
            depth = 0
            for j in range(i, len(text)):
                if text[j] == "{":
                    depth += 1
                elif text[j] == "}":
                    depth -= 1
                    if depth == 0:
                        candidate = text[i : j + 1]
                        if "\"SYSTEM_PACKET\"" in candidate or "SYSTEM_PACKET" in candidate:
                            return candidate
                        break
    return None


def _validate_packet(packet: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    if not isinstance(packet, dict):
        errors.append("SYSTEM_PACKET must be an object")
        return errors
    if "manager" not in packet or not isinstance(packet.get("manager"), str):
        errors.append("'manager' missing or not a string")
    agents = packet.get("agents")
    if not isinstance(agents, dict):
        errors.append("'agents' missing or not an object")
    else:
        ac = agents.get("AgentC")
        ax = agents.get("AgentX")
        if not isinstance(ac, dict) or ac.get("role") != "execute":
            errors.append("AgentC.role must equal 'execute'")
        if not isinstance(ax, dict) or ax.get("role") != "research_verify":
            errors.append("AgentX.role must equal 'research_verify'")
    tools = packet.get("tools")
    if not isinstance(tools, dict):
        errors.append("'tools' missing or not an object")
    else:
        if not isinstance(tools.get("available"), list):
            errors.append("tools.available must be a list")
        if not isinstance(tools.get("recommended"), list):
            errors.append("tools.recommended must be a list")
    if not isinstance(packet.get("next_actions"), dict):
        errors.append("next_actions must be an object")
    return errors


def run(args: Dict[str, Any]) -> Dict[str, Any]:
    text = args.get("text", "")
    errors: List[str] = []
    packet_obj: Optional[Dict[str, Any]] = None
    fix_suggestions: List[str] = []
    # Try fenced JSON first
    jstr = _extract_from_fence(text)
    if not jstr:
        jstr = _extract_first_json_with_system_packet(text)
    if not jstr:
        errors.append("No JSON SYSTEM_PACKET found in text (no fenced JSON or inline object)")
        fix_suggestions.append("Include a ```json fenced block containing {\"SYSTEM_PACKET\": {...}} or include a JSON object with 'SYSTEM_PACKET'.")
        return {"is_valid": False, "errors": errors, "packet": None, "fix_suggestions": fix_suggestions}
    try:
        parsed = json.loads(jstr)
    except Exception as e:
        errors.append(f"Failed to parse JSON: {e}")
        fix_suggestions.append("Ensure the JSON is valid and properly escaped inside the response.")
        return {"is_valid": False, "errors": errors, "packet": None, "fix_suggestions": fix_suggestions}
    # Accept either top-level SYSTEM_PACKET or object that contains it
    if "SYSTEM_PACKET" in parsed:
        packet = parsed["SYSTEM_PACKET"]
    elif parsed.get("SYSTEM_PACKET") is not None:
        packet = parsed.get("SYSTEM_PACKET")
    else:
        # Maybe parsed itself is the packet
        if any(k in parsed for k in ("manager", "agents", "tools", "next_actions")):
            packet = parsed
        else:
            errors.append("JSON does not contain a 'SYSTEM_PACKET' key or expected packet fields")
            fix_suggestions.append("Wrap the packet in {\"SYSTEM_PACKET\": {...}} or include the required keys.")
            return {"is_valid": False, "errors": errors, "packet": None, "fix_suggestions": fix_suggestions}
    packet_obj = packet
    # Validate required structure
    structure_errors = _validate_packet(packet_obj)
    if structure_errors:
        errors.extend(structure_errors)
        fix_suggestions.append("Ensure 'manager' (string), 'agents' with AgentC/AgentX roles, 'tools.available' list, 'tools.recommended' list, and 'next_actions' object are present and correctly typed.")
        return {"is_valid": False, "errors": errors, "packet": packet_obj, "fix_suggestions": fix_suggestions}
    # success
    return {"is_valid": True, "errors": [], "packet": packet_obj, "fix_suggestions": []}


if __name__ == "__main__":
    import sys

    sample = """
Here is an assistant response.
```json
{"SYSTEM_PACKET": {"manager": "local", "agents": {"AgentC": {"role": "execute"}, "AgentX": {"role": "research_verify"}}, "tools": {"available": [], "recommended": []}, "next_actions": {}}}
```
"""
    out = run({"text": sample})
    print(out)
"""SYSTEM_PACKET extraction and validation tool."""
import json
import re
from typing import Any, Dict, List, Optional


def _extract_from_fence(text: str) -> Optional[str]:
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, flags=re.S)
    if m:
        return m.group(1)
    return None


def _extract_first_json_with_system_packet(text: str) -> Optional[str]:
    for i, ch in enumerate(text):
        if ch == "{":
            depth = 0
            for j in range(i, len(text)):
                if text[j] == "{":
                    depth += 1
                elif text[j] == "}":
                    depth -= 1
                    if depth == 0:
                        candidate = text[i : j + 1]
                        if "\"SYSTEM_PACKET\"" in candidate or "SYSTEM_PACKET" in candidate:
                            return candidate
                        break
    return None


def _validate_packet(packet: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    if not isinstance(packet, dict):
        errors.append("SYSTEM_PACKET must be an object")
        return errors
    if "manager" not in packet or not isinstance(packet.get("manager"), str):
        errors.append("'manager' missing or not a string")
    agents = packet.get("agents")
    if not isinstance(agents, dict):
        errors.append("'agents' missing or not an object")
    else:
        ac = agents.get("AgentC")
        ax = agents.get("AgentX")
        if not isinstance(ac, dict) or ac.get("role") != "execute":
            errors.append("AgentC.role must equal 'execute'")
        if not isinstance(ax, dict) or ax.get("role") != "research_verify":
            errors.append("AgentX.role must equal 'research_verify'")
    tools = packet.get("tools")
    if not isinstance(tools, dict):
        errors.append("'tools' missing or not an object")
    else:
        if not isinstance(tools.get("available"), list):
            errors.append("tools.available must be a list")
        if not isinstance(tools.get("recommended"), list):
            errors.append("tools.recommended must be a list")
    if not isinstance(packet.get("next_actions"), dict):
        errors.append("next_actions must be an object")
    return errors


def run(args: Dict[str, Any]) -> Dict[str, Any]:
    text = args.get("text", "")
    errors: List[str] = []
    packet_obj: Optional[Dict[str, Any]] = None
    fix_suggestions: List[str] = []
    jstr = _extract_from_fence(text)
    if not jstr:
        jstr = _extract_first_json_with_system_packet(text)
    if not jstr:
        errors.append("No JSON SYSTEM_PACKET found in text (no fenced JSON or inline object)")
        fix_suggestions.append("Include a ```json fenced block containing {\"SYSTEM_PACKET\": {...}} or include a JSON object with 'SYSTEM_PACKET'.")
        return {"is_valid": False, "errors": errors, "packet": None, "fix_suggestions": fix_suggestions}
    try:
        parsed = json.loads(jstr)
    except Exception as e:
        errors.append(f"Failed to parse JSON: {e}")
        fix_suggestions.append("Ensure the JSON is valid and properly escaped inside the response.")
        return {"is_valid": False, "errors": errors, "packet": None, "fix_suggestions": fix_suggestions}
    if "SYSTEM_PACKET" in parsed:
        packet = parsed["SYSTEM_PACKET"]
    elif parsed.get("SYSTEM_PACKET") is not None:
        packet = parsed.get("SYSTEM_PACKET")
    else:
        if any(k in parsed for k in ("manager", "agents", "tools", "next_actions")):
            packet = parsed
        else:
            errors.append("JSON does not contain a 'SYSTEM_PACKET' key or expected packet fields")
            fix_suggestions.append("Wrap the packet in {\"SYSTEM_PACKET\": {...}} or include the required keys.")
            return {"is_valid": False, "errors": errors, "packet": None, "fix_suggestions": fix_suggestions}
    packet_obj = packet
    structure_errors = _validate_packet(packet_obj)
    if structure_errors:
        errors.extend(structure_errors)
        fix_suggestions.append("Ensure 'manager' (string), 'agents' with AgentC/AgentX roles, 'tools.available' list, 'tools.recommended' list, and 'next_actions' object are present and correctly typed.")
        return {"is_valid": False, "errors": errors, "packet": packet_obj, "fix_suggestions": fix_suggestions}
    return {"is_valid": True, "errors": [], "packet": packet_obj, "fix_suggestions": []}
