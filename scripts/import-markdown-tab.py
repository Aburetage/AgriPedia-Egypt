from __future__ import annotations

import argparse
import json
import re
from datetime import date
from pathlib import Path


def clean_inline(text: str) -> str:
    text = text.replace("\ufeff", "").replace("\u00a0", " ")
    text = re.sub(r"\*\*([^*]+?)\*\*", r"\1", text)
    text = re.sub(r"\*([^*\n]+?)\*", r"\1", text)
    text = re.sub(r"`([^`]+?)`", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def heading_number_depth(text: str) -> int | None:
    match = re.match(r"^\s*(\d+(?:\.\d+)*)[.)]?\s+", text)
    if not match:
        return None
    return len(match.group(1).split("."))


def strip_heading_number(text: str) -> str:
    return re.sub(r"^\s*\d+(?:\.\d+)*[.)]?\s+", "", text).strip()


def paragraph_item(text: str) -> dict[str, object]:
    pest_intro_markers = (
        "ومن بين الآفات التي أحدثت",
        "Among the pests that have",
    )
    if any(marker in text for marker in pest_intro_markers):
        return {
            "type": "doc-callout",
            "tone": "amber",
            "icon": "fas fa-bug",
            "text": text,
        }
    return {"type": "doc-paragraph", "text": text}


def read_markdown_parts(markdown_paths: list[Path]) -> list[str]:
    combined_lines: list[str] = []
    repeated_titles: list[str] = []

    for part_index, markdown_path in enumerate(markdown_paths):
        lines = markdown_path.read_text(encoding="utf-8").splitlines()
        if part_index == 0:
            combined_lines.extend(lines)
            repeated_titles = [
                clean_inline(match.group(1))
                for line in lines
                if (match := re.match(r"^#\s+(.+)$", line.strip()))
            ][:2]
            continue

        matched_titles = 0
        part_started = False
        for raw_line in lines:
            line = raw_line.strip()
            if not part_started and not line:
                continue
            if not part_started and matched_titles < len(repeated_titles):
                heading_match = re.match(r"^#\s+(.+)$", line)
                if heading_match and clean_inline(heading_match.group(1)) == repeated_titles[matched_titles]:
                    matched_titles += 1
                    continue
            part_started = True
            combined_lines.append(raw_line)

        if combined_lines and combined_lines[-1].strip():
            combined_lines.append("")

    return combined_lines


def parse_markdown(
    markdown_paths: list[Path],
    references: list[dict[str, object]],
    reference_heading: str,
    reference_id: str,
) -> list[dict[str, object]]:
    lines = read_markdown_parts(markdown_paths)
    article_references = references
    for index, raw_line in enumerate(lines):
        heading_match = re.match(r"^#{1,6}\s+(.+)$", raw_line.strip())
        if not heading_match:
            continue
        heading_text = clean_inline(heading_match.group(1))
        if re.match(r"^(?:المراجع|مراجع|References)\b", heading_text, flags=re.I):
            if not article_references:
                article_references = parse_reference_lines(lines[index + 1:])
            lines = lines[:index]
            break

    items: list[dict[str, object]] = []
    paragraph_lines: list[str] = []
    list_items: list[str] = []
    table_lines: list[str] = []
    title_h1_count = 0
    inside_promoted_h1_section = False

    def flush_paragraph() -> None:
        nonlocal paragraph_lines
        if paragraph_lines:
            text = clean_inline(" ".join(line.strip() for line in paragraph_lines))
            if text:
                items.append(paragraph_item(text))
            paragraph_lines = []

    def flush_list() -> None:
        nonlocal list_items
        if list_items:
            items.append({"type": "doc-list", "items": list_items})
            list_items = []

    def parse_table_row(line: str) -> list[str]:
        return [clean_inline(cell.strip()) for cell in line.strip().strip("|").split("|")]

    def is_table_separator(cells: list[str]) -> bool:
        return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells)

    def flush_table() -> None:
        nonlocal table_lines
        if not table_lines:
            return
        rows = [parse_table_row(line) for line in table_lines]
        if len(rows) >= 2:
            headers = rows[0]
            body_rows = [row for row in rows[1:] if not is_table_separator(row)]
            if headers and body_rows:
                items.append({"type": "doc-table", "headers": headers, "rows": body_rows})
            else:
                for row in rows:
                    items.append({"type": "doc-paragraph", "text": " | ".join(row)})
        else:
            items.append({"type": "doc-paragraph", "text": " | ".join(rows[0])})
        table_lines = []

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            flush_list()
            flush_table()
            continue

        if re.fullmatch(r"-{3,}", line):
            flush_paragraph()
            flush_list()
            flush_table()
            continue

        if line.startswith("|") and line.endswith("|"):
            flush_paragraph()
            flush_list()
            table_lines.append(line)
            continue

        flush_table()

        heading_match = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading_match:
            flush_paragraph()
            flush_list()
            level = len(heading_match.group(1))
            text = clean_inline(heading_match.group(2))
            number_depth = heading_number_depth(text)

            if level == 1:
                title_h1_count += 1
                if title_h1_count > 2:
                    level = 2
                    inside_promoted_h1_section = True
            elif number_depth is not None:
                level = min(max(number_depth, 2), 4)
            elif inside_promoted_h1_section and level == 2:
                level = 3

            if level >= 2:
                text = strip_heading_number(text)
            items.append({"type": "doc-heading", "level": level, "text": text})
            continue

        bold_line_match = re.match(r"^\*\*(.+?)\*\*\s*$", line)
        if bold_line_match:
            flush_paragraph()
            flush_list()
            items.append({"type": "doc-heading", "level": 4, "text": clean_inline(bold_line_match.group(1))})
            continue

        unordered_match = re.match(r"^[*+-]\s+(.+)$", line)
        if unordered_match:
            flush_paragraph()
            list_items.append(clean_inline(unordered_match.group(1)))
            continue

        ordered_match = re.match(r"^(\d+)[.)]\s+(.+)$", line)
        if ordered_match:
            flush_paragraph()
            list_items.append(f"{ordered_match.group(1)}. {clean_inline(ordered_match.group(2))}")
            continue

        flush_list()
        paragraph_lines.append(line)

    flush_paragraph()
    flush_list()
    flush_table()

    if article_references:
        items.append({
            "type": "doc-heading",
            "level": 3,
            "text": reference_heading,
            "id": reference_id,
        })
        items.append({"type": "reference-list", "items": article_references})
    return items


def parse_reference_lines(lines: list[str]) -> list[dict[str, object]]:
    references: list[dict[str, object]] = []
    current_number: int | None = None
    current_text: list[str] = []
    current_url = ""

    def finish() -> None:
        nonlocal current_number, current_text, current_url
        if current_number is not None:
            references.append({
                "number": current_number,
                "text": clean_inline(" ".join(current_text)),
                "url": current_url.strip(),
            })
        current_number = None
        current_text = []
        current_url = ""

    for raw_line in lines + [""]:
        line = raw_line.strip()
        if not line:
            continue
        numbered = re.match(r"^(\d+)\.\s+(.+)$", line)
        if numbered:
            finish()
            current_number = int(numbered.group(1))
            current_text = [numbered.group(2)]
            continue
        if re.match(r"^https?://", line, flags=re.I):
            current_url = line
            continue
        current_text.append(line)

    finish()
    return references


def parse_references(reference_path: Path) -> list[dict[str, object]]:
    return parse_reference_lines(reference_path.read_text(encoding="utf-8").splitlines())


def update_tab(markdown_paths: list[Path], tab_path: Path, references: list[dict[str, object]], reference_heading: str, reference_id: str) -> int:
    data = json.loads(tab_path.read_text(encoding="utf-8"))
    items = parse_markdown(markdown_paths, references, reference_heading, reference_id)
    data["content_blocks"] = [{
        "type": "doc-article",
        "items": items,
        "meta": {"updated_at": date.today().isoformat()},
    }]
    tab_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return sum(len(item.get("items", [])) for item in items if item.get("type") == "reference-list")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import bilingual Markdown tab content into AgriPedia JSON data.")
    parser.add_argument("--ar-md", required=True, action="append")
    parser.add_argument("--en-md", required=True, action="append")
    parser.add_argument("--refs")
    parser.add_argument("--ar-tab", default="data/ar/tuta/0.json")
    parser.add_argument("--en-tab", default="data/en/tuta/0.json")
    parser.add_argument("--reference-id", default="chapter-one-references")
    args = parser.parse_args()

    references = parse_references(Path(args.refs)) if args.refs else []
    ar_reference_count = update_tab([Path(path) for path in args.ar_md], Path(args.ar_tab), references, "المراجع", args.reference_id)
    en_reference_count = update_tab([Path(path) for path in args.en_md], Path(args.en_tab), references, "References", args.reference_id)

    print(json.dumps({
        "references": max(ar_reference_count, en_reference_count),
        "ar_parts": len(args.ar_md),
        "en_parts": len(args.en_md),
        "ar_tab": args.ar_tab,
        "en_tab": args.en_tab,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
