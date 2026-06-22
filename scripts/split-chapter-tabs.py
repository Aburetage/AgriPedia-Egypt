#!/usr/bin/env python3
"""Split chapter tabs into independently loadable JSON files."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


for language in ("ar", "en"):
    chapter_path = ROOT / "data" / language / "tuta.json"
    chapter = json.loads(chapter_path.read_text(encoding="utf-8-sig"))
    if not all(isinstance(tab.get("content_blocks"), list) for tab in chapter.get("tabs", [])):
        print(f"{language}: already split; skipped")
        continue

    manifest_tabs = []
    for index, tab in enumerate(chapter["tabs"]):
        relative_path = f"tuta/{index}.json"
        write_json(ROOT / "data" / language / relative_path, tab)
        manifest_tabs.append({"tab_title": tab["tab_title"], "content_path": relative_path})
        print(f"{language}: tab {index} -> {relative_path} ({len(tab['content_blocks'])} blocks)")

    manifest = {key: value for key, value in chapter.items() if key != "tabs"}
    manifest["tabs"] = manifest_tabs
    write_json(chapter_path, manifest)
    print(f"{language}: wrote slim manifest with {len(manifest_tabs)} tabs")
