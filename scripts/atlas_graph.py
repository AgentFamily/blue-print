#!/usr/bin/env python3
"""Validate and render the Atlas node/route graph without UI dependencies."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GRAPH_PATH = ROOT / "atlas.graph.json"

DISTRICTS = {"Acquisition", "Operations", "Revenue", "Experience"}
CRITICALITY = {"low", "med", "high"}
STATUS = {"stable", "degraded", "down"}
ROUTE_TYPES = {"primary", "secondary", "fallback"}
ZONES = {"01", "02", "03", "04", "05"}


def _is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _require_string_list(node: dict[str, Any], field: str, ctx: str, errors: list[str]) -> None:
    value = node.get(field)
    if not isinstance(value, list):
        errors.append(f"{ctx}.{field}: expected array of strings")
        return
    for i, item in enumerate(value):
        if not _is_non_empty_string(item):
            errors.append(f"{ctx}.{field}[{i}]: expected non-empty string")


def load_graph(path: Path) -> dict[str, Any]:
    try:
        payload = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise SystemExit(f"Graph file not found: {path}") from exc
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON at {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit("Graph root must be a JSON object.")
    return data


def validate_graph(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    nodes = data.get("nodes")
    routes = data.get("routes")
    if not isinstance(nodes, list):
        errors.append("nodes: expected array")
        nodes = []
    if not isinstance(routes, list):
        errors.append("routes: expected array")
        routes = []

    node_ids: list[str] = []
    route_ids: list[str] = []

    node_required = [
        "id",
        "label",
        "district",
        "zone",
        "inputs",
        "outputs",
        "dependencies",
        "fallbacks",
        "criticality",
    ]

    for i, node in enumerate(nodes):
        ctx = f"nodes[{i}]"
        if not isinstance(node, dict):
            errors.append(f"{ctx}: expected object")
            continue

        for field in node_required:
            if field not in node:
                errors.append(f"{ctx}.{field}: missing required field")

        node_id = node.get("id")
        if _is_non_empty_string(node_id):
            node_ids.append(str(node_id))
        else:
            errors.append(f"{ctx}.id: expected non-empty string")

        if not _is_non_empty_string(node.get("label")):
            errors.append(f"{ctx}.label: expected non-empty string")

        district = node.get("district")
        if district not in DISTRICTS:
            errors.append(f"{ctx}.district: expected one of {sorted(DISTRICTS)}")

        zone = node.get("zone")
        if zone is not None and zone not in ZONES:
            errors.append(f"{ctx}.zone: expected one of {sorted(ZONES)}")

        _require_string_list(node, "inputs", ctx, errors)
        _require_string_list(node, "outputs", ctx, errors)
        _require_string_list(node, "dependencies", ctx, errors)
        _require_string_list(node, "fallbacks", ctx, errors)

        criticality = node.get("criticality")
        if criticality not in CRITICALITY:
            errors.append(f"{ctx}.criticality: expected one of {sorted(CRITICALITY)}")

        if "status" in node:
            status = node.get("status")
            if status not in STATUS:
                errors.append(f"{ctx}.status: expected one of {sorted(STATUS)}")

    duplicate_node_ids = sorted({x for x in node_ids if node_ids.count(x) > 1})
    for dup in duplicate_node_ids:
        errors.append(f"nodes: duplicate id '{dup}'")
    node_id_set = set(node_ids)

    route_required = ["id", "name", "path", "type"]

    for i, route in enumerate(routes):
        ctx = f"routes[{i}]"
        if not isinstance(route, dict):
            errors.append(f"{ctx}: expected object")
            continue

        for field in route_required:
            if field not in route:
                errors.append(f"{ctx}.{field}: missing required field")

        route_id = route.get("id")
        if _is_non_empty_string(route_id):
            route_ids.append(str(route_id))
        else:
            errors.append(f"{ctx}.id: expected non-empty string")

        if not _is_non_empty_string(route.get("name")):
            errors.append(f"{ctx}.name: expected non-empty string")

        route_type = route.get("type")
        if route_type not in ROUTE_TYPES:
            errors.append(f"{ctx}.type: expected one of {sorted(ROUTE_TYPES)}")

        path = route.get("path")
        if not isinstance(path, list) or len(path) < 2:
            errors.append(f"{ctx}.path: expected array with at least two node ids")
            path = []
        for p, node_id in enumerate(path):
            if not _is_non_empty_string(node_id):
                errors.append(f"{ctx}.path[{p}]: expected non-empty string")
                continue
            if str(node_id) not in node_id_set:
                errors.append(f"{ctx}.path[{p}]: unknown node id '{node_id}'")
            if p > 0 and str(path[p - 1]) == str(node_id):
                errors.append(f"{ctx}.path[{p}]: consecutive duplicate node id '{node_id}'")

        if "reliability" in route:
            reliability = route.get("reliability")
            if not isinstance(reliability, (int, float)):
                errors.append(f"{ctx}.reliability: expected number in [0, 100]")
            elif reliability < 0 or reliability > 100:
                errors.append(f"{ctx}.reliability: expected number in [0, 100]")

        if "avg_handoff_ms" in route:
            avg = route.get("avg_handoff_ms")
            if not isinstance(avg, int) or avg < 0:
                errors.append(f"{ctx}.avg_handoff_ms: expected non-negative integer")

    duplicate_route_ids = sorted({x for x in route_ids if route_ids.count(x) > 1})
    for dup in duplicate_route_ids:
        errors.append(f"routes: duplicate id '{dup}'")

    for i, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        ctx = f"nodes[{i}]"
        node_id = str(node.get("id", "")).strip()

        for field in ("dependencies", "fallbacks"):
            refs = node.get(field)
            if not isinstance(refs, list):
                continue
            for r, ref in enumerate(refs):
                if not _is_non_empty_string(ref):
                    continue
                ref_id = str(ref)
                if ref_id not in node_id_set:
                    errors.append(f"{ctx}.{field}[{r}]: unknown node id '{ref_id}'")
                if node_id and ref_id == node_id:
                    errors.append(f"{ctx}.{field}[{r}]: self-reference is not allowed")

    return errors


def render_graph_as_text(data: dict[str, Any]) -> str:
    nodes = data.get("nodes", [])
    routes = data.get("routes", [])
    graph_id = str(data.get("graph_id") or "atlas_graph").strip()
    version = str(data.get("version") or "unversioned").strip()

    lines: list[str] = []
    lines.append(f"Graph: {graph_id} (v{version})")
    lines.append("")
    lines.append(f"Nodes ({len(nodes)}):")
    for i, node in enumerate(nodes, start=1):
        zone = str(node.get("zone") or "-")
        status = str(node.get("status") or "n/a")
        deps = ", ".join(node.get("dependencies", [])) or "-"
        fallbacks = ", ".join(node.get("fallbacks", [])) or "-"
        lines.append(
            f"{i}. {node.get('id')} | {node.get('label')} | district={node.get('district')} | zone={zone} | "
            f"criticality={node.get('criticality')} | status={status}"
        )
        lines.append(f"   inputs: {', '.join(node.get('inputs', [])) or '-'}")
        lines.append(f"   outputs: {', '.join(node.get('outputs', [])) or '-'}")
        lines.append(f"   dependencies: {deps}")
        lines.append(f"   fallbacks: {fallbacks}")

    lines.append("")
    lines.append(f"Routes ({len(routes)}):")
    for i, route in enumerate(routes, start=1):
        path = " -> ".join(route.get("path", []))
        reliability = route.get("reliability")
        handoff = route.get("avg_handoff_ms")
        metrics = []
        if reliability is not None:
            metrics.append(f"reliability={reliability}")
        if handoff is not None:
            metrics.append(f"avg_handoff_ms={handoff}")
        metric_text = f" | {' | '.join(metrics)}" if metrics else ""
        lines.append(
            f"{i}. {route.get('id')} | {route.get('name')} | type={route.get('type')}{metric_text}"
        )
        lines.append(f"   path: {path}")

    return "\n".join(lines)


def _print_errors(errors: list[str]) -> None:
    print("INVALID graph")
    for err in errors:
        print(f"- {err}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Atlas graph validator and list renderer.")
    parser.add_argument(
        "--path",
        default=str(DEFAULT_GRAPH_PATH),
        help="Path to atlas graph JSON file.",
    )

    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate", help="Validate graph schema and references.")
    list_parser = sub.add_parser("list", help="Render graph as text list (no UI).")
    list_parser.add_argument(
        "--skip-validation",
        action="store_true",
        help="Render list even if validation fails.",
    )
    sub.add_parser("check", help="Validate then render list.")

    args = parser.parse_args(argv)
    path = Path(args.path).resolve()
    data = load_graph(path)
    errors = validate_graph(data)

    if args.command == "validate":
        if errors:
            _print_errors(errors)
            return 1
        print(f"OK: graph is valid ({len(data.get('nodes', []))} nodes, {len(data.get('routes', []))} routes)")
        return 0

    if args.command == "list":
        if errors and not args.skip_validation:
            _print_errors(errors)
            return 1
        print(render_graph_as_text(data))
        return 0

    if args.command == "check":
        if errors:
            _print_errors(errors)
            return 1
        print(f"OK: graph is valid ({len(data.get('nodes', []))} nodes, {len(data.get('routes', []))} routes)")
        print("")
        print(render_graph_as_text(data))
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
