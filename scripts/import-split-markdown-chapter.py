from __future__ import annotations

import argparse
import importlib.util
import json
import re
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_markdown_importer():
    importer_path = Path(__file__).with_name("import-markdown-tab.py")
    spec = importlib.util.spec_from_file_location("import_markdown_tab", importer_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {importer_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def source_path(source_dir: Path, chapter: int, index: int, lang_name: str) -> Path:
    if index == 0:
        pattern = f"chapter_{chapter:02d}_part_00_*_{lang_name}.md"
    else:
        pattern = f"chapter_{chapter:02d}_section_{index:02d}_*_{lang_name}.md"
    matches = sorted(source_dir.glob(pattern))
    if len(matches) > 1:
        contents = {match.read_bytes() for match in matches}
        if len(contents) == 1:
            return min(matches, key=lambda match: len(match.name))
    if len(matches) != 1:
        raise FileNotFoundError(
            f"Expected one {lang_name} source for part {index}, found {len(matches)}: {pattern}"
        )
    return matches[0]


def markdown_metadata(path: Path, clean_inline) -> dict[str, str]:
    headings: list[tuple[int, str]] = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        match = re.match(r"^(#{1,6})\s+(.+)$", line.strip())
        if match:
            headings.append((len(match.group(1)), clean_inline(match.group(2))))

    h1_positions = [i for i, (level, _) in enumerate(headings) if level == 1]
    if len(h1_positions) < 4:
        raise ValueError(f"{path.name}: expected at least four level-one headings")

    first_h1, second_h1, label_h1, title_h1 = h1_positions[:4]
    subtitle = ""
    metadata_range: list[str] = []
    for level, text in headings[second_h1 + 1:]:
        if re.match(r"^\d+(?:\.\d+)*[.)]?\s+", text):
            break
        if level == 2:
            metadata_range.append(text)
    if metadata_range:
        subtitle = metadata_range[0]

    return {
        "chapter_heading": headings[first_h1][1],
        "tab_title": headings[second_h1][1],
        "part_label": headings[label_h1][1],
        "part_short_title": headings[title_h1][1],
        "part_subtitle": subtitle,
    }


def remove_metadata_headings(items: list[dict], metadata: dict[str, str]) -> list[dict]:
    removable = [
        metadata["part_label"],
        metadata["part_short_title"],
        metadata["part_subtitle"],
    ]
    remaining = [value for value in removable if value]
    cleaned: list[dict] = []
    h1_seen = 0
    for item in items:
        if item.get("type") == "doc-heading" and int(item.get("level", 0)) == 1:
            h1_seen += 1
        text = str(item.get("text", "")).strip()
        if h1_seen >= 2 and item.get("type") == "doc-heading" and text in remaining:
            remaining.remove(text)
            continue
        cleaned.append(item)
    if remaining:
        raise ValueError(f"Could not remove metadata headings: {remaining}")
    return cleaned


def import_part(
    importer,
    source: Path,
    output: Path,
    lang: str,
    index: int,
) -> dict[str, str]:
    metadata = markdown_metadata(source, importer.clean_inline)
    reference_heading = "المراجع" if lang == "ar" else "References"
    items = importer.parse_markdown(
        [source],
        [],
        reference_heading,
        f"chapter-ten-part-{index}-references",
    )
    items = remove_metadata_headings(items, metadata)
    part_title = f'{metadata["part_label"]}: {metadata["part_short_title"]}'
    part_manifest = {
        "part_title": part_title,
        "part_short_title": metadata["part_short_title"],
        "part_subtitle": metadata["part_subtitle"],
        "content_path": f"tuta/9/{index}.json",
    }
    part_data = {
        "tab_title": metadata["tab_title"],
        "part_index": index,
        **part_manifest,
        "content_blocks": [{
            "type": "doc-article",
            "items": items,
            "meta": {
                "updated_at": date.today().isoformat(),
                "part_index": index,
                "part_title": part_title,
                "part_subtitle": metadata["part_subtitle"],
            },
        }],
    }
    write_json(output, part_data)
    return part_manifest


def update_manifests(lang: str, tab_title: str, imported_parts: dict[int, dict[str, str]]) -> None:
    data_root = ROOT / "data" / lang
    split_manifest_path = data_root / "tuta" / "9.json"
    existing_parts: dict[int, dict[str, str]] = {}
    if split_manifest_path.exists():
        for part in read_json(split_manifest_path).get("parts", []):
            match = re.search(r"/(\d+)\.json$", str(part.get("content_path", "")))
            if match:
                existing_parts[int(match.group(1))] = part
    existing_parts.update(imported_parts)
    ordered_parts = [existing_parts[index] for index in sorted(existing_parts)]
    if list(sorted(existing_parts)) != list(range(len(existing_parts))):
        raise ValueError(f"{lang}: chapter parts must remain contiguous from zero")

    lightweight_manifest = {"tab_title": tab_title, "parts": ordered_parts}
    write_json(split_manifest_path, lightweight_manifest)

    chapter_manifest_path = data_root / "tuta.json"
    chapter_manifest = read_json(chapter_manifest_path)
    tab_manifest = {"tab_title": tab_title, "parts": ordered_parts}
    if len(chapter_manifest["tabs"]) == 9:
        chapter_manifest["tabs"].append(tab_manifest)
    elif len(chapter_manifest["tabs"]) > 9:
        chapter_manifest["tabs"][9] = tab_manifest
    else:
        raise ValueError(f"{lang}: expected nine existing tabs before chapter ten")
    write_json(chapter_manifest_path, chapter_manifest)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import a range of bilingual Markdown files as lazy-loaded parts of chapter ten."
    )
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--end", type=int, required=True)
    args = parser.parse_args()
    if args.start < 0 or args.end < args.start:
        parser.error("The part range must satisfy 0 <= start <= end")

    importer = load_markdown_importer()
    for lang, lang_name in (("ar", "arabic"), ("en", "english")):
        imported_parts: dict[int, dict[str, str]] = {}
        tab_title = ""
        for index in range(args.start, args.end + 1):
            source = source_path(args.source_dir, 10, index, lang_name)
            output = ROOT / "data" / lang / "tuta" / "9" / f"{index}.json"
            part_manifest = import_part(importer, source, output, lang, index)
            imported_parts[index] = part_manifest
            tab_title = read_json(output)["tab_title"]
        update_manifests(lang, tab_title, imported_parts)
        print(f"{lang}: imported chapter ten parts {args.start}-{args.end}")


if __name__ == "__main__":
    main()
