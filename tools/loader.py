"""Tool manifest loader and validator.

Reads /Applications/AgentC .app/tools/manifest.json and validates entries.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

MANIFEST_PATH = Path("/Applications/AgentC .app/tools/manifest.json")


def load_manifest(manifest_path: str | Path = None) -> Dict[str, Dict[str, Any]]:
    path = Path(manifest_path) if manifest_path else MANIFEST_PATH
    if not path.exists():
        raise FileNotFoundError(f"Manifest not found at {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise TypeError("Manifest root must be a JSON array of tool entries")
    errors = []
    registry: Dict[str, Dict[str, Any]] = {}
    for i, entry in enumerate(data):
        try:
            validate_manifest_entry(entry)
        except Exception as e:
            errors.append(f"Entry[{i}]: {e}")
        else:
            registry[entry["name"]] = entry
    if errors:
        raise ValueError("Manifest validation errors:\n" + "\n".join(errors))
    return registry


def validate_manifest_entry(entry: Dict[str, Any]) -> None:
    if not isinstance(entry, dict):
        raise TypeError("tool entry must be an object")
    required = ["name", "description", "entrypoint", "args_schema", "permissions"]
    for k in required:
        if k not in entry:
            raise KeyError(f"missing required field '{k}'")
    if not isinstance(entry["name"], str) or not entry["name"]:
        raise TypeError("'name' must be a non-empty string")
    if not isinstance(entry["entrypoint"], str) or ":" not in entry["entrypoint"]:
        raise TypeError("'entrypoint' must be a string like 'module.sub:callable'")
    if not isinstance(entry["args_schema"], dict):
        raise TypeError("'args_schema' must be an object")
    perms = entry["permissions"]
    if not isinstance(perms, dict):
        raise TypeError("'permissions' must be an object")
    fs = perms.get("filesystem")
    if fs not in ("read", "write", "rw", "none"):
        raise ValueError("permissions.filesystem must be one of 'read','write','rw','none'")
    net = perms.get("network")
    if net not in ("none", "allow"):
        raise ValueError("permissions.network must be one of 'none','allow'")
    sec = perms.get("secrets")
    if sec not in ("none", "allow"):
        raise ValueError("permissions.secrets must be one of 'none','allow'")


def validate_manifest(manifest_path: str | Path = None) -> None:
    load_manifest(manifest_path)


if __name__ == "__main__":
    import sys

    try:
        reg = load_manifest()
        print(f"Loaded {len(reg)} tools")
    except Exception as e:
        print(f"Manifest validation failed: {e}")
        sys.exit(1)
