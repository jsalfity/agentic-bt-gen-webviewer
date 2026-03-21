#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from html import escape
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - optional dependency
    yaml = None

APP_ROOT = Path(__file__).resolve().parent
DATA_ROOT = APP_ROOT / "data_snapshots"
GENERATED_ROOT = DATA_ROOT / "generated"
TASK_SPEC_ROOT = DATA_ROOT / "task_specs"
OUTPUT_PATH = APP_ROOT / "public" / "data" / "catalog.json"

METHOD_ORDER = {"M-Core": 0, "B1": 1, "B0": 2, "Other": 3}
SUITE_LABELS = {
    "core60": "Core 60",
    "language50": "Language 50",
}
ARCHETYPE_LABELS = {
    "sequential_pick": "Sequential Pick",
    "selector_search": "Selector Search",
    "pick_and_place": "Pick and Place",
    "search_and_place": "Search and Place",
    "pick_and_return": "Pick and Return",
}


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def parse_scalar(value: str) -> Any:
    lowered = value.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if lowered in {"null", "none"}:
        return None
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    if re.fullmatch(r"-?\d+\.\d+", value):
        return float(value)
    return value


def load_yaml_file(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    if yaml is not None:
        data = yaml.safe_load(text) or {}
        if isinstance(data, dict):
            return data
        return {}
    return parse_simple_yaml(text)


def parse_simple_yaml(text: str) -> dict[str, Any]:
    lines: list[tuple[int, str]] = []
    for raw_line in text.splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#") or raw_line.strip() == "---":
            continue
        indent = len(raw_line) - len(raw_line.lstrip(" "))
        lines.append((indent, raw_line.strip()))

    def parse_block(index: int, indent: int) -> tuple[Any, int]:
        if index >= len(lines):
            return {}, index
        if lines[index][1].startswith("- "):
            return parse_list(index, indent)
        return parse_dict(index, indent)

    def parse_dict(index: int, indent: int) -> tuple[dict[str, Any], int]:
        data: dict[str, Any] = {}
        while index < len(lines):
            line_indent, stripped = lines[index]
            if line_indent < indent:
                break
            if line_indent > indent:
                index += 1
                continue
            if stripped.startswith("- "):
                break

            key, _, remainder = stripped.partition(":")
            key = key.strip()
            remainder = remainder.lstrip()
            index += 1

            if remainder:
                data[key] = parse_scalar(remainder)
                continue

            if index < len(lines) and (
                lines[index][0] > line_indent
                or (lines[index][0] == line_indent and lines[index][1].startswith("- "))
            ):
                child_indent = lines[index][0]
                child, index = parse_block(index, child_indent)
                data[key] = child
            else:
                data[key] = {}
        return data, index

    def parse_list(index: int, indent: int) -> tuple[list[Any], int]:
        items: list[Any] = []
        while index < len(lines):
            line_indent, stripped = lines[index]
            if line_indent < indent:
                break
            if line_indent != indent or not stripped.startswith("- "):
                break

            rest = stripped[2:].strip()
            index += 1

            if not rest:
                if index < len(lines) and lines[index][0] > line_indent:
                    child, index = parse_block(index, lines[index][0])
                    items.append(child)
                else:
                    items.append(None)
                continue

            if ":" in rest:
                key, _, remainder = rest.partition(":")
                item: dict[str, Any] = {}
                if remainder.strip():
                    item[key.strip()] = parse_scalar(remainder.strip())
                else:
                    if index < len(lines) and lines[index][0] > line_indent:
                        child, index = parse_block(index, lines[index][0])
                        item[key.strip()] = child
                    else:
                        item[key.strip()] = {}
                if index < len(lines) and lines[index][0] > line_indent:
                    child, index = parse_block(index, lines[index][0])
                    if isinstance(child, dict):
                        item.update(child)
                items.append(item)
                continue

            items.append(parse_scalar(rest))
        return items, index

    if not lines:
        return {}
    parsed, _ = parse_block(0, lines[0][0])
    return parsed if isinstance(parsed, dict) else {}


def normalize_suite(value: str | None) -> str | None:
    if not value:
        return None
    lowered = value.lower()
    if "language50" in lowered or "lang50" in lowered:
        return "language50"
    if "core60" in lowered:
        return "core60"
    return None


def detect_method(name: str) -> str:
    lowered = name.lower()
    if "mcore" in lowered:
        return "M-Core"
    if re.search(r"(^|[_-])b1($|[_-])", lowered):
        return "B1"
    if re.search(r"(^|[_-])b0($|[_-])", lowered):
        return "B0"
    return "Other"


def sort_key(batch_name: str) -> tuple[int, str]:
    method = detect_method(batch_name)
    return (METHOD_ORDER.get(method, 99), batch_name)


def humanize_token(value: str) -> str:
    return value.replace("_", " ").replace("-", " ").strip().title()


def compact_bt_label(node: dict[str, Any]) -> str:
    node_type = str(node.get("type") or "node")
    if node_type in {"sequence", "selector", "fallback", "parallel"}:
        return humanize_token(node_type)
    action = node.get("action")
    if action:
        return humanize_token(str(action))
    name = str(node.get("name") or node.get("condition") or node_type)
    return humanize_token(name)


def compact_bt_detail(node: dict[str, Any]) -> str:
    params = node.get("params")
    if not isinstance(params, dict) or not params:
        return ""
    parts = [str(value).replace("_", " ") for _, value in list(params.items())[:2]]
    return ", ".join(parts)


def wrap_svg_text(text: str, max_chars: int = 16) -> list[str]:
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if len(candidate) <= max_chars:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines[:3]


def bt_node_style(node: dict[str, Any]) -> dict[str, str]:
    node_type = str(node.get("type") or "node").lower()
    if node_type in {"selector", "fallback"}:
        return {"shape": "hex", "fill": "#69e0eb", "stroke": "#197c85"}
    if node_type in {"sequence", "parallel"}:
        return {"shape": "rect", "fill": "#ffd24f", "stroke": "#9a7400"}
    if node_type == "condition":
        return {"shape": "ellipse", "fill": "#d8dde5", "stroke": "#717784"}
    return {"shape": "ellipse", "fill": "#e5e8ee", "stroke": "#7c8391"}


def bt_node_lines(node: dict[str, Any]) -> list[str]:
    title = compact_bt_label(node)
    detail = compact_bt_detail(node)
    lines = wrap_svg_text(title, max_chars=15)
    if detail:
        lines.extend(wrap_svg_text(detail, max_chars=17)[:1])
    return lines[:3]


def bt_node_box(node: dict[str, Any]) -> tuple[float, float]:
    lines = bt_node_lines(node)
    max_line = max((len(line) for line in lines), default=10)
    width = max(94.0, min(156.0, 24.0 + max_line * 6.7))
    height = 28.0 + len(lines) * 13.0
    return width, height


def render_svg_shape(style: dict[str, str], cx: float, cy: float, width: float, height: float) -> str:
    fill = style["fill"]
    stroke = style["stroke"]
    shape = style["shape"]
    if shape == "rect":
        x = cx - width / 2
        y = cy - height / 2
        return (
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{width:.1f}" height="{height:.1f}" '
            f'rx="9" ry="9" fill="{fill}" stroke="{stroke}" stroke-width="1.3" />'
        )
    if shape == "hex":
        x0 = cx - width / 2
        x1 = cx - width * 0.28
        x2 = cx + width * 0.28
        x3 = cx + width / 2
        y0 = cy - height / 2
        y1 = cy
        y2 = cy + height / 2
        points = [
            (x1, y0), (x2, y0), (x3, y1), (x2, y2), (x1, y2), (x0, y1),
        ]
        point_str = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
        return f'<polygon points="{point_str}" fill="{fill}" stroke="{stroke}" stroke-width="1.3" />'
    return (
        f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{width/2:.1f}" ry="{height/2:.1f}" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="1.3" />'
    )


def render_svg_text(cx: float, cy: float, node: dict[str, Any]) -> str:
    lines = bt_node_lines(node)
    start_y = cy - (len(lines) - 1) * 6
    chunks = [
        f'<text x="{cx:.1f}" y="{start_y + idx * 14:.1f}" text-anchor="middle" '
        f'font-family="Avenir Next, Segoe UI, sans-serif" font-size="{11.5 if idx == 0 else 10}" '
        f'font-weight="{700 if idx == 0 else 500}" fill="#172033">{escape(line)}</text>'
        for idx, line in enumerate(lines)
    ]
    return "".join(chunks)


def render_bt_svg(bt_json: dict[str, Any] | None) -> str | None:
    root = bt_json.get("root") if isinstance(bt_json, dict) else None
    if not isinstance(root, dict):
        return None

    sibling_gap = 28.0
    level_gap = 88.0
    margin = 24.0
    id_counter = 0

    def clone_tree(node: dict[str, Any], depth: int = 0) -> dict[str, Any]:
        nonlocal id_counter
        children = [clone_tree(child, depth + 1) for child in node.get("children", []) if isinstance(child, dict)]
        width, height = bt_node_box(node)
        item = {
            "id": f"n{id_counter}",
            "node": node,
            "depth": depth,
            "children": children,
            "width": width,
            "height": height,
        }
        id_counter += 1
        return item

    tree = clone_tree(root)

    def count_leaves(item: dict[str, Any]) -> int:
        if not item["children"]:
            item["leaf_count"] = 1
            return 1
        total = sum(count_leaves(child) for child in item["children"])
        item["leaf_count"] = total
        return total

    def compute_subtree_width(item: dict[str, Any]) -> float:
        if not item["children"]:
            item["subtree_width"] = item["width"]
            return item["subtree_width"]
        children_width = sum(compute_subtree_width(child) for child in item["children"])
        children_width += sibling_gap * (len(item["children"]) - 1)
        item["children_width"] = children_width
        item["subtree_width"] = max(item["width"], children_width)
        return item["subtree_width"]

    def assign_positions(item: dict[str, Any], x_left: float) -> None:
        item["x"] = x_left + item["subtree_width"] / 2
        if not item["children"]:
            return
        child_x = x_left + (item["subtree_width"] - item["children_width"]) / 2
        for child in item["children"]:
            assign_positions(child, child_x)
            child_x += child["subtree_width"] + sibling_gap

    def assign_y(item: dict[str, Any]) -> None:
        item["y"] = margin + item["depth"] * level_gap
        for child in item["children"]:
            assign_y(child)

    def max_depth(item: dict[str, Any]) -> int:
        if not item["children"]:
            return item["depth"]
        return max(max_depth(child) for child in item["children"])

    count_leaves(tree)
    compute_subtree_width(tree)
    assign_positions(tree, margin)
    assign_y(tree)
    width = max(tree["subtree_width"] + margin * 2, 280.0)
    height = margin * 2 + max_depth(tree) * level_gap + tree["height"]

    edge_parts: list[str] = []
    node_parts: list[str] = []

    def walk(item: dict[str, Any]) -> None:
        for child in item["children"]:
            edge_parts.append(
                f'<line x1="{item["x"]:.1f}" y1="{item["y"] + item["height"] / 2 - 2:.1f}" '
                f'x2="{child["x"]:.1f}" y2="{child["y"] - child["height"] / 2 + 2:.1f}" '
                f'stroke="#7b7f89" stroke-width="1.2" stroke-linecap="round" />'
            )
            walk(child)

        style = bt_node_style(item["node"])
        node_parts.append(render_svg_shape(style, item["x"], item["y"], item["width"], item["height"]))
        node_parts.append(
            render_svg_text(item["x"], item["y"], item["node"])
        )

    walk(tree)

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.1f} {height:.1f}" '
        f'width="100%" height="100%" preserveAspectRatio="xMidYMin meet">'
        f'<rect x="0" y="0" width="{width:.1f}" height="{height:.1f}" fill="#fffdf8" rx="14" ry="14" />'
        f'{"".join(edge_parts)}{"".join(node_parts)}</svg>'
    )


def summarize_task_spec(task: dict[str, Any], suite_meta: dict[str, Any]) -> dict[str, Any]:
    static = ((task.get("required") or {}).get("static") or {}) if isinstance(task, dict) else {}
    success = (task.get("success") or {}) if isinstance(task, dict) else {}

    control_flow = []
    if static.get("must_use_memory_sequence"):
        control_flow.append("Use a memory sequence for the main execution path")
    if static.get("must_use_selector"):
        control_flow.append("Use selector fallback for the search branches")

    success_conditions = []
    if success.get("must_hold_category"):
        success_conditions.append(f"Robot must be holding `{success['must_hold_category']}`")
    if success.get("robot_at"):
        success_conditions.append(f"Robot must finish at `{success['robot_at']}`")
    if success.get("category_at_location"):
        for category, location in (success.get("category_at_location") or {}).items():
            success_conditions.append(f"`{category}` must end at `{location}`")

    return {
        "suite_name": suite_meta.get("suite_name"),
        "environment": suite_meta.get("environment"),
        "world_file": suite_meta.get("world_file"),
        "robot_name": suite_meta.get("robot_name"),
        "archetype": task.get("archetype"),
        "archetype_label": ARCHETYPE_LABELS.get(str(task.get("archetype")), humanize_token(str(task.get("archetype", "task")))),
        "required_actions": list(static.get("actions") or []),
        "required_locations": list(static.get("locations") or []),
        "control_flow": control_flow,
        "success_conditions": success_conditions,
        "runtime": suite_meta.get("runtime") or {},
    }


def load_suites() -> dict[str, dict[str, Any]]:
    suites: dict[str, dict[str, Any]] = {}
    for path in sorted(TASK_SPEC_ROOT.glob("*.yaml")):
        data = load_yaml_file(path)
        suite_name = data.get("suite_name")
        suite_id = normalize_suite(suite_name)
        if not isinstance(suite_name, str) or not suite_id:
            continue
        tasks = {}
        for task in data.get("tasks") or []:
            if isinstance(task, dict) and task.get("id"):
                tasks[str(task["id"])] = task
        suites[suite_id] = {
            "suite_id": suite_id,
            "label": SUITE_LABELS.get(suite_id, suite_id),
            "suite_name": suite_name,
            "environment": data.get("environment"),
            "world_file": data.get("world_file"),
            "robot_name": data.get("robot_name"),
            "runtime": data.get("runtime") or {},
            "tasks": tasks,
        }
    return suites


def build_batch(batch_dir: Path, suites: dict[str, dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    summary = load_json(batch_dir / "results_summary.json", {})
    results = load_json(batch_dir / "results.json", [])
    if not isinstance(results, list):
        return None

    suite_name = None
    suite_names = summary.get("suite_names")
    if isinstance(suite_names, list) and suite_names:
        suite_name = str(suite_names[0])
    else:
        for row in results:
            if isinstance(row, dict) and row.get("suite_name"):
                suite_name = str(row.get("suite_name"))
                break

    suite_id = normalize_suite(suite_name) or normalize_suite(batch_dir.name)
    if not suite_id or suite_id not in suites:
        return None

    suite_meta = suites[suite_id]
    method = detect_method(batch_dir.name)
    task_items: list[dict[str, Any]] = []
    archetype_counts: dict[str, int] = {}

    for row in results:
        if not isinstance(row, dict):
            continue
        task_id = str(row.get("id", ""))
        task_spec = suite_meta["tasks"].get(task_id)
        if not task_id or not task_spec:
            continue
        bt_json = None
        bt_path_value = row.get("bt_path")
        if isinstance(bt_path_value, str) and bt_path_value:
            bt_path = Path(bt_path_value)
            if bt_path.exists():
                bt_json = load_json(bt_path, None)
        archetype = str(task_spec.get("archetype") or row.get("archetype") or "unknown")
        archetype_counts[archetype] = archetype_counts.get(archetype, 0) + 1
        task_items.append(
            {
                "id": task_id,
                "prompt": task_spec.get("task_prompt") or row.get("task_prompt"),
                "archetype": archetype,
                "archetype_label": ARCHETYPE_LABELS.get(archetype, humanize_token(archetype)),
                "success": row.get("success"),
                "exec_status": row.get("exec_status"),
                "failure_cause": row.get("failure_cause"),
                "task_spec": task_spec,
                "task_spec_view": summarize_task_spec(task_spec, suite_meta),
                "result": row,
                "bt_json": bt_json,
                "bt_svg": render_bt_svg(bt_json),
            }
        )

    task_items.sort(key=lambda item: item["id"])
    batch_record = {
        "name": batch_dir.name,
        "method": method,
        "suite_id": suite_id,
        "suite_label": suite_meta["label"],
        "suite_name": suite_meta["suite_name"],
        "environment": suite_meta["environment"],
        "count": summary.get("count", len(task_items)),
        "summary": summary,
        "archetype_counts": archetype_counts,
        "task_ids": [item["id"] for item in task_items],
    }
    return batch_record, task_items


def build_catalog() -> dict[str, Any]:
    suites = load_suites()
    batches: list[dict[str, Any]] = []
    tasks_by_batch: dict[str, list[dict[str, Any]]] = {}

    for batch_dir in sorted((path for path in GENERATED_ROOT.iterdir() if path.is_dir()), key=lambda path: sort_key(path.name)):
        built = build_batch(batch_dir, suites)
        if not built:
            continue
        batch_record, task_items = built
        batches.append(batch_record)
        tasks_by_batch[batch_record["name"]] = task_items

    suite_index = {}
    for suite_id, suite_meta in suites.items():
        suite_index[suite_id] = {
            "suite_id": suite_id,
            "label": suite_meta["label"],
            "suite_name": suite_meta["suite_name"],
            "environment": suite_meta["environment"],
            "world_file": suite_meta["world_file"],
            "robot_name": suite_meta["robot_name"],
            "runtime": suite_meta["runtime"],
            "task_count": len(suite_meta["tasks"]),
        }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "project": {
            "title": "Agentic BT Generation",
            "subtitle": "Inspect PyRoboSim evaluation results and run selected behavior trees live.",
        },
        "methods": ["M-Core", "B1", "B0", "Other"],
        "suites": suite_index,
        "batches": batches,
        "tasks_by_batch": tasks_by_batch,
    }


def main() -> None:
    catalog = build_catalog()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    print(f"Wrote catalog with {len(catalog['batches'])} batches to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
