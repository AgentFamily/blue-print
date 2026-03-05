"""Tool runner and sandbox policy enforcement."""
from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any, Dict

from tools import loader

WORKSPACE_ROOT = Path("/Applications/AgentC .app").resolve()


class ToolRunError(RuntimeError):
    pass


def _validate_args_against_schema(args: Dict[str, Any], schema: Dict[str, Any]) -> None:
    if schema.get("type") != "object":
        raise TypeError("Only 'object' args_schema supported")
    if not isinstance(args, dict):
        raise TypeError("args must be an object/dict")
    props = schema.get("properties", {})
    required = schema.get("required", [])
    for r in required:
        if r not in args:
            raise ValueError(f"Missing required arg '{r}'")
    for k, v in args.items():
        if k in props:
            p = props[k]
            expected = p.get("type")
            if expected:
                if expected == "string" and not isinstance(v, str):
                    raise TypeError(f"arg '{k}' must be string")
                if expected == "number" and not isinstance(v, (int, float)):
                    raise TypeError(f"arg '{k}' must be number")
                if expected == "boolean" and not isinstance(v, bool):
                    raise TypeError(f"arg '{k}' must be boolean")
                if expected == "object" and not isinstance(v, dict):
                    raise TypeError(f"arg '{k}' must be object")
                if expected == "array" and not isinstance(v, list):
                    raise TypeError(f"arg '{k}' must be array")


def _enforce_filesystem_policy(reg_entry: Dict[str, Any], args: Dict[str, Any]) -> None:
    perms = reg_entry.get("permissions", {})
    fsperm = perms.get("filesystem", "none")
    for k, v in args.items():
        if isinstance(v, str) and ("/" in v or v.startswith(".") or k.endswith("_path") or k == "path"):
            p = Path(v)
            try:
                resolved = (p if p.is_absolute() else (WORKSPACE_ROOT / p)).resolve()
            except Exception:
                raise ToolRunError(f"Invalid path in arg '{k}': {v}")
            if fsperm == "none":
                raise ToolRunError(f"Tool does not have filesystem permission but arg '{k}' looks like path: {v}")
            try:
                resolved.relative_to(WORKSPACE_ROOT)
            except Exception:
                raise ToolRunError(f"Filesystem access to {resolved} is outside workspace")


def _enforce_network_policy(reg_entry: Dict[str, Any]) -> None:
    perms = reg_entry.get("permissions", {})
    net = perms.get("network", "none")
    if net != "allow":
        return


def run_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    registry = loader.load_manifest()
    if name not in registry:
        raise ToolRunError(f"Unknown tool: {name}")
    reg = registry[name]
    schema = reg.get("args_schema", {"type": "object"})
    _validate_args_against_schema(args, schema)
    _enforce_network_policy(reg)
    _enforce_filesystem_policy(reg, args)
    entrypoint = reg["entrypoint"]
    if ":" not in entrypoint:
        raise ToolRunError("Invalid entrypoint format in manifest")
    module_path, func_name = entrypoint.split(":", 1)
    try:
        module = importlib.import_module(module_path)
    except Exception as e:
        raise ToolRunError(f"Failed to import module '{module_path}': {e}")
    if not hasattr(module, func_name):
        raise ToolRunError(f"Module '{module_path}' has no attribute '{func_name}'")
    func = getattr(module, func_name)
    if not callable(func):
        raise ToolRunError(f"Entrypoint '{entrypoint}' is not callable")
    result = func(args)
    if not isinstance(result, dict):
        raise ToolRunError("Tool did not return a dict result")
    return result


if __name__ == "__main__":
    import sys

    try:
        reg = loader.load_manifest()
        print(f"Registry: {list(reg.keys())}")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
