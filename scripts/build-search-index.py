"""Build compact, ready-to-load bilingual search indexes from split chapter tabs."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REFERENCE_TITLES = {"المراجع", "references"}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def item_text_parts(item: dict) -> list[str]:
    parts: list[str] = []
    if isinstance(item.get("text"), str):
        parts.append(item["text"])
    if isinstance(item.get("items"), list):
        parts.extend(value for value in item["items"] if isinstance(value, str))
    if isinstance(item.get("headers"), list):
        parts.extend(value for value in item["headers"] if isinstance(value, str))
    if isinstance(item.get("rows"), list):
        for row in item["rows"]:
            if isinstance(row, list):
                parts.extend(value for value in row if isinstance(value, str))
            elif isinstance(row, dict):
                parts.extend(str(row[key]) for key in ("label", "value") if row.get(key) is not None)
    return parts


def build_language_index(lang: str) -> list[dict]:
    data_root = ROOT / "data" / lang
    app_index = read_json(data_root / "index.json")
    chapter_ids: list[str] = []
    for group in app_index["sidebar"]:
        for link in group["links"]:
            chapter_id = link.get("target")
            if not link.get("disabled") and chapter_id not in chapter_ids:
                chapter_ids.append(chapter_id)

    search_index: list[dict] = []
    for chapter_id in chapter_ids:
        manifest = read_json(data_root / f"{chapter_id}.json")
        for tab_index, tab_manifest in enumerate(manifest["tabs"]):
            tab_path = data_root / tab_manifest.get("content_path", f"{chapter_id}/{tab_index}.json")
            tab = read_json(tab_path)
            article = next((block for block in tab.get("content_blocks", []) if block.get("type") == "doc-article"), None)
            if not article:
                continue

            section_index = 0
            section_title = tab["tab_title"]
            section_parts: list[str] = []

            def flush_section() -> None:
                if not section_index or not section_parts:
                    return
                text = re.sub(r"\s+", " ", " ".join(section_parts)).strip()
                search_index.append({
                    "chapterId": chapter_id,
                    "chapterTitle": manifest["chapter_title"],
                    "tabIndex": tab_index,
                    "tabTitle": tab["tab_title"],
                    "sectionIndex": section_index,
                    "sectionTitle": section_title,
                    "text": text,
                })

            for item in article.get("items", []):
                if item.get("type") == "doc-heading" and int(item.get("level", 0)) == 2:
                    flush_section()
                    title = str(item.get("text", "")).strip()
                    if title.casefold() in REFERENCE_TITLES:
                        section_parts = []
                        break
                    section_index += 1
                    section_title = title
                    section_parts = []
                    continue
                if section_index and item.get("type") != "reference-list":
                    section_parts.extend(item_text_parts(item))
            else:
                flush_section()

    return search_index


def main() -> None:
    for lang in ("ar", "en"):
        index = build_language_index(lang)
        output = ROOT / "data" / lang / "search-index.json"
        output.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"{lang}: {len(index)} sections -> {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
