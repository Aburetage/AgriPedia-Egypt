import argparse
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def paragraph_text(node):
    return "".join(part.text or "" for part in node.iter(W + "t")).strip()


def read_document(path):
    items = []
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
        body = root.find(".//" + W + "body")
        for node in body:
            if node.tag == W + "p":
                text = paragraph_text(node)
                if not text:
                    continue
                properties = node.find(W + "pPr")
                style = ""
                is_list = False
                if properties is not None:
                    style_node = properties.find(W + "pStyle")
                    if style_node is not None:
                        style = style_node.get(W + "val", "")
                    is_list = properties.find(W + "numPr") is not None
                items.append({"kind": "paragraph", "style": style, "is_list": is_list, "text": text})
            elif node.tag == W + "tbl":
                rows = []
                for table_row in node.findall(W + "tr"):
                    rows.append([paragraph_text(cell) for cell in table_row.findall(W + "tc")])
                items.append({"kind": "table", "rows": rows})
    return items


def convert_document(path, tab_title, updated_at):
    source = read_document(path)
    converted = []
    pending_list = []
    opening_heading_count = 0
    inside_promoted_section = False

    def flush_list():
        nonlocal pending_list
        if pending_list:
            converted.append({"type": "doc-list", "items": pending_list})
            pending_list = []

    for entry in source:
        if entry["kind"] == "table":
            flush_list()
            rows = entry["rows"]
            converted.append({
                "type": "doc-table",
                "headers": rows[0] if rows else [],
                "rows": rows[1:] if len(rows) > 1 else [],
            })
            continue

        if entry["is_list"] or entry["style"] == "Compact":
            pending_list.append(entry["text"])
            continue

        flush_list()
        heading_match = re.fullmatch(r"Heading([1-4])", entry["style"])
        if heading_match:
            source_level = int(heading_match.group(1))
            level = source_level
            if source_level == 1:
                opening_heading_count += 1
                if opening_heading_count > 2:
                    level = 2
                    inside_promoted_section = True
            elif inside_promoted_section:
                level = min(source_level + 1, 4)
            item = {"type": "doc-heading", "level": level, "text": entry["text"]}
            if entry["text"].strip().rstrip(":") == "المراجع":
                item["id"] = f"chapter-{Path(path).stem}-references"
            converted.append(item)
        elif entry["style"] == "BlockText":
            converted.append({"type": "doc-quote", "text": entry["text"]})
        else:
            converted.append({"type": "doc-paragraph", "text": entry["text"]})

    flush_list()
    return {
        "tab_title": tab_title,
        "content_blocks": [{"type": "doc-article", "items": converted, "meta": {"updated_at": updated_at}}],
    }


def count_source_content(path):
    entries = read_document(path)
    paragraphs = sum(1 for entry in entries if entry["kind"] == "paragraph")
    cells = sum(len(row) for entry in entries if entry["kind"] == "table" for row in entry["rows"])
    return paragraphs, cells


def count_tab_content(tab):
    paragraphs = 0
    cells = 0
    for item in tab["content_blocks"][0]["items"]:
        if item["type"] == "doc-list":
            paragraphs += len(item["items"])
        elif item["type"] == "doc-table":
            cells += len(item.get("headers", [])) + sum(len(row) for row in item["rows"])
        elif item["type"] != "reference-list":
            paragraphs += 1
    return paragraphs, cells


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    parser.add_argument("--tab-output", help="Write one converted standalone tab JSON file")
    parser.add_argument("--updated-at", default="2026-06-20")
    parser.add_argument("chapters", nargs="+", help="DOCX_PATH::TAB_TITLE")
    args = parser.parse_args()

    new_tabs = []
    for specification in args.chapters:
        source_path, tab_title = specification.split("::", 1)
        tab = convert_document(source_path, tab_title, args.updated_at)
        expected = count_source_content(source_path)
        actual = count_tab_content(tab)
        if expected != actual:
            raise RuntimeError(f"Content mismatch for {source_path}: source={expected}, imported={actual}")
        new_tabs.append(tab)
        print(f"{Path(source_path).name}: preserved {actual[0]} paragraphs and {actual[1]} table cells")

    if args.tab_output:
        if len(new_tabs) != 1:
            raise RuntimeError("--tab-output requires exactly one DOCX chapter")
        tab_output = Path(args.tab_output)
        tab_output.parent.mkdir(parents=True, exist_ok=True)
        tab_output.write_text(json.dumps(new_tabs[0], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote standalone tab to {tab_output}")
        return

    if not args.output:
        raise RuntimeError("Use --output or --tab-output")
    output = Path(args.output)
    data = json.loads(output.read_text(encoding="utf-8"))

    data["tabs"] = data["tabs"][:2] + new_tabs
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(data['tabs'])} ordered tabs to {output}")


if __name__ == "__main__":
    main()
