from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PART_HEADING = re.compile(
    r"^(?:الجزء\s+(?:الأول|الثاني|الثالث|الرابع|الخامس)|Part\s+(?:One|Two|Three|Four|Five))\s*:",
    re.IGNORECASE,
)
INTRODUCTION = re.compile(r"^(?:مقدمة|Introduction)$", re.IGNORECASE)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def split_language(lang: str) -> None:
    data_root = ROOT / "data" / lang
    source_path = data_root / "tuta" / "5.json"
    source = read_json(source_path)
    article = next(block for block in source["content_blocks"] if block.get("type") == "doc-article")
    items = article["items"]
    chapter_headings = [
        item for item in items
        if item.get("type") == "doc-heading" and int(item.get("level", 0)) == 1
    ][:2]
    part_indexes = [
        index for index, item in enumerate(items)
        if item.get("type") == "doc-heading" and PART_HEADING.match(str(item.get("text", "")).strip())
    ]
    if len(part_indexes) != 5:
        raise ValueError(f"{lang}: expected five chapter-six parts, found {len(part_indexes)}")

    parts: list[dict] = []
    for part_index, start in enumerate(part_indexes):
        end = part_indexes[part_index + 1] if part_index + 1 < len(part_indexes) else len(items)
        title = str(items[start]["text"]).strip()
        segment = [dict(item) for item in items[start + 1:end]]
        subtitle = ""

        heading_positions = [
            index for index, item in enumerate(segment)
            if item.get("type") == "doc-heading"
        ]
        section_positions = [
            index for index, item in enumerate(segment)
            if item.get("type") == "doc-heading" and int(item.get("level", 0)) == 2
        ]
        first_heading = heading_positions[0] if heading_positions else None
        first_section = section_positions[0] if section_positions else None
        if first_heading is not None and first_heading != first_section:
            subtitle = str(segment[first_heading].get("text", "")).strip()
            segment.pop(first_heading)
        elif len(section_positions) > 1:
            first_text = str(segment[section_positions[0]].get("text", "")).strip()
            second_text = str(segment[section_positions[1]].get("text", "")).strip()
            if not INTRODUCTION.match(first_text) and INTRODUCTION.match(second_text):
                subtitle = first_text
                segment.pop(section_positions[0])

        short_title = title.split(":", 1)[1].strip() if ":" in title else title
        content_path = f"tuta/5/{part_index}.json"
        part_data = {
            "tab_title": source["tab_title"],
            "part_index": part_index,
            "part_title": title,
            "part_short_title": short_title,
            "part_subtitle": subtitle,
            "content_blocks": [{
                "type": "doc-article",
                "items": [*chapter_headings, *segment],
                "meta": {
                    **article.get("meta", {}),
                    "part_index": part_index,
                    "part_title": title,
                    "part_subtitle": subtitle,
                },
            }],
        }
        write_json(data_root / content_path, part_data)
        parts.append({
            "part_title": title,
            "part_short_title": short_title,
            "part_subtitle": subtitle,
            "content_path": content_path,
        })

    lightweight_manifest = {"tab_title": source["tab_title"], "parts": parts}
    write_json(source_path, lightweight_manifest)

    chapter_manifest_path = data_root / "tuta.json"
    chapter_manifest = read_json(chapter_manifest_path)
    chapter_manifest["tabs"][5].pop("content_path", None)
    chapter_manifest["tabs"][5]["parts"] = parts
    write_json(chapter_manifest_path, chapter_manifest)
    print(f"{lang}: split chapter six into {len(parts)} parts")


def main() -> None:
    for language in ("ar", "en"):
        split_language(language)


if __name__ == "__main__":
    main()
