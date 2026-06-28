from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEXT_TYPES = {"doc-paragraph", "doc-quote", "doc-callout"}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_compiler(glossary: list[dict]):
    aliases: dict[str, dict] = {}
    for entry in glossary:
        for alias in entry.get("aliases", []):
            aliases[str(alias).casefold()] = entry
    ordered = sorted(aliases, key=len, reverse=True)
    pattern = re.compile(
        rf"(?<![\w])({'|'.join(re.escape(alias) for alias in ordered)})(?![\w])",
        re.IGNORECASE,
    )

    def prepare(value: str, used: set[str]) -> str:
        def replace(match: re.Match) -> str:
            entry = aliases.get(match.group(0).casefold())
            if not entry or entry["id"] in used:
                return match.group(0)
            used.add(entry["id"])
            return f"[[term:{entry['id']}]]{match.group(0)}[[/term]]"

        return "[[prepared]]" + pattern.sub(replace, value)

    return prepare


def prepare_article(items: list[dict], prepare) -> None:
    used: set[str] = set()
    for item in items:
        item_type = item.get("type")
        if item_type in TEXT_TYPES and isinstance(item.get("text"), str):
            prepared = prepare(item["text"], used)
            item["prepared_text"] = prepared
        elif item_type == "doc-list" and isinstance(item.get("items"), list):
            prepared_items = [prepare(value, used) if isinstance(value, str) else value for value in item["items"]]
            item["prepared_items"] = prepared_items
        elif item_type == "doc-table":
            if isinstance(item.get("headers"), list):
                prepared_headers = [prepare(value, used) if isinstance(value, str) else value for value in item["headers"]]
                item["prepared_headers"] = prepared_headers
            if isinstance(item.get("rows"), list):
                prepared_rows = []
                for row in item["rows"]:
                    if isinstance(row, list):
                        prepared_rows.append([prepare(value, used) if isinstance(value, str) else value for value in row])
                    elif isinstance(row, dict):
                        prepared_row = dict(row)
                        for key in ("label", "value"):
                            if isinstance(prepared_row.get(key), str):
                                prepared_row[key] = prepare(prepared_row[key], used)
                        prepared_rows.append(prepared_row)
                    else:
                        prepared_rows.append(row)
                item["prepared_rows"] = prepared_rows


def process_language(lang: str) -> None:
    data_root = ROOT / "data" / lang
    prepare = build_compiler(read_json(data_root / "glossary.json"))
    changed_files = 0
    for path in sorted((data_root / "tuta").rglob("*.json")):
        data = read_json(path)
        articles = [
            block for block in data.get("content_blocks", [])
            if block.get("type") == "doc-article" and isinstance(block.get("items"), list)
        ]
        if not articles:
            continue
        for article in articles:
            prepare_article(article["items"], prepare)
        write_json(path, data)
        changed_files += 1
    print(f"{lang}: precompiled smart terms in {changed_files} files")


def main() -> None:
    for language in ("ar", "en"):
        process_language(language)


if __name__ == "__main__":
    main()
