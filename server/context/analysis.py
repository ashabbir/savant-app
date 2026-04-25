"""Deterministic source analysis helpers for context code tools."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


_PY_DEF_RE = re.compile(r"^\s*def\s+([A-Za-z_]\w*)\s*\(")
_JS_CLASS_RE = re.compile(r"^\s*class\s+([A-Za-z_$][\w$]*)")
_JS_FN_RE = re.compile(r"^\s*(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\()")


@dataclass
class AnalysisTarget:
    path: str
    name: str | None = None
    node_type: str | None = None


def _clamp(n: int, low: int = 0, high: int = 10_000) -> int:
    return max(low, min(high, n))


def _line_count(text: str) -> int:
    if not text:
        return 0
    return text.count("\n") + 1


def _score_text(text: str) -> dict[str, Any]:
    if not text.strip():
        return {"complexity": 0, "findings": [], "line_count": 0}
    lines = text.splitlines()
    complexity = 1
    findings: list[dict[str, Any]] = []
    max_depth = 0
    depth = 0
    for idx, raw in enumerate(lines, start=1):
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            continue
        depth += stripped.count("{")
        max_depth = max(max_depth, depth)
        depth -= stripped.count("}")
        depth = max(depth, 0)
        if len(stripped) > 140:
            findings.append({
                "severity": "low",
                "category": "style",
                "rule_id": "long_line",
                "line": idx,
                "title": "Long line",
                "detail": "Line exceeds 140 characters.",
            })

    if max_depth > 4:
        findings.append({
            "severity": "medium",
            "category": "structural",
            "rule_id": "deep_nesting",
            "line": 1,
            "title": "Deep nesting",
            "detail": f"Detected nested block depth {max_depth}.",
        })
        complexity += max_depth - 4

    param_hits = 0
    for line in lines:
        if _PY_DEF_RE.match(line) or _JS_CLASS_RE.match(line) or _JS_FN_RE.match(line):
            params = line[line.find("(") + 1: line.rfind(")") if ")" in line else len(line)]
            param_hits = max(param_hits, len([p for p in params.split(",") if p.strip()]))
    if param_hits > 5:
        findings.append({
            "severity": "low" if param_hits < 8 else "medium",
            "category": "structural",
            "rule_id": "parameter_overload",
            "line": 1,
            "title": "Parameter overload",
            "detail": f"Detected {param_hits} parameters.",
        })

    complexity += _clamp(_line_count(text) // 25, 0, 8)
    return {
        "complexity": complexity,
        "findings": findings,
        "line_count": _line_count(text),
    }


def _pick_target_text(content: str, target: AnalysisTarget | None = None) -> dict[str, Any]:
    if not target or not target.name:
        return {"text": content, "target_found": False}

    lines = content.splitlines()
    if target.node_type == "class":
        start = None
        indent = None
        for idx, line in enumerate(lines):
            if re.match(rf"^\s*class\s+{re.escape(target.name)}\b", line):
                start = idx
                indent = len(line) - len(line.lstrip())
                break
        if start is None:
            return {"text": "", "target_found": False}
        end = len(lines)
        for idx in range(start + 1, len(lines)):
            cur = lines[idx]
            if not cur.strip():
                continue
            cur_indent = len(cur) - len(cur.lstrip())
            if cur_indent <= indent and re.match(r"^\s*(class|def|function)\b", cur):
                end = idx
                break
        return {"text": "\n".join(lines[start:end]), "target_found": True}

    matches = [
        idx for idx, line in enumerate(lines)
        if re.search(rf"\b{re.escape(target.name)}\b", line)
    ]
    if not matches:
        return {"text": "", "target_found": False}
    start = max(0, matches[0] - 2)
    end = min(len(lines), matches[0] + 40)
    return {"text": "\n".join(lines[start:end]), "target_found": True}


def _apply_unified_diff(original: str, diff_text: str) -> str:
    if not diff_text.strip():
        return original
    original_lines = original.splitlines()
    out: list[str] = []
    i = 0
    diff_lines = diff_text.splitlines()
    idx = 0
    while idx < len(diff_lines):
        line = diff_lines[idx]
        if not line.startswith("@@"):
            idx += 1
            continue
        m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", line)
        if not m:
            idx += 1
            continue
        start = max(0, int(m.group(1)) - 1)
        while i < start and i < len(original_lines):
            out.append(original_lines[i])
            i += 1
        idx += 1
        while idx < len(diff_lines) and not diff_lines[idx].startswith("@@"):
            h = diff_lines[idx]
            if h.startswith(" "):
                if i < len(original_lines):
                    out.append(original_lines[i])
                    i += 1
            elif h.startswith("-"):
                i += 1
            elif h.startswith("+"):
                out.append(h[1:])
            idx += 1
    out.extend(original_lines[i:])
    return "\n".join(out)


def analyze_code(
    *,
    content_before: str = "",
    content_after: str | None = None,
    target: AnalysisTarget | None = None,
    diff: str | None = None,
    target_missing_is_new: bool = False,
) -> dict[str, Any]:
    before = content_before or ""
    if content_after is None and diff is not None:
        content_after = _apply_unified_diff(before, diff)
    if content_after is None:
        content_after = before

    before_pick = _pick_target_text(before, target)
    after_pick = _pick_target_text(content_after, target)
    if target_missing_is_new and not before_pick["target_found"]:
        before_pick = {"text": "", "target_found": False}
    if target_missing_is_new and not before.strip() and not after_pick["target_found"]:
        before_pick = {"text": "", "target_found": False}

    before_score = _score_text(before_pick["text"])
    after_score = _score_text(after_pick["text"])
    delta = after_score["complexity"] - before_score["complexity"]

    return {
        "target": {
            "path": target.path if target else "",
            "name": target.name if target else None,
            "node_type": target.node_type if target else None,
            "found_before": before_pick["target_found"],
            "found_after": after_pick["target_found"],
        },
        "before": before_score,
        "after": after_score,
        "delta": {
            "complexity": delta,
            "findings": len(after_score["findings"]) - len(before_score["findings"]),
            "line_count": after_score["line_count"] - before_score["line_count"],
        },
        "summary": {
            "before_complexity": before_score["complexity"],
            "after_complexity": after_score["complexity"],
            "delta_complexity": delta,
            "before_findings": len(before_score["findings"]),
            "after_findings": len(after_score["findings"]),
            "status": "new" if not before_pick["target_found"] and after_pick["target_found"] else "updated",
        },
    }
