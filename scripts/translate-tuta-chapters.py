#!/usr/bin/env python3
"""Translate imported Arabic Tuta chapters while preserving their JSON structure.

The script translates only human-readable leaves, caches every completed string,
and validates that no paragraph, list entry, heading, or table cell is lost.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
AR_PATH = ROOT / "data" / "ar" / "tuta.json"
EN_PATH = ROOT / "data" / "en" / "tuta.json"
CACHE_PATH = ROOT / "scripts" / ".tuta-ar-en-cache.json"
ENDPOINT = "https://translate.googleapis.com/translate_a/single"
SEPARATOR = "ZXQSEPARATORTOKENZXQ"
LATIN_RE = re.compile(r"[A-Za-z][A-Za-z0-9À-ž._/+:'’()\[\],;–—-]*(?:\s+[A-Za-z0-9À-ž._/+:'’()\[\],;–—-]+)*")
PLACEHOLDER_RE = re.compile(r"ZXQLAT(\d{4})ZXQ")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def save_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def protect_latin(text: str) -> tuple[str, list[str]]:
    values: list[str] = []

    def replace(match: re.Match[str]) -> str:
        value = match.group(0)
        # A lone Latin letter is often a table code and should still be stable.
        values.append(value)
        return f"ZXQLAT{len(values) - 1:04d}ZXQ"

    return LATIN_RE.sub(replace, text), values


def restore_latin(text: str, values: list[str]) -> str:
    def replace(match: re.Match[str]) -> str:
        index = int(match.group(1))
        return values[index] if index < len(values) else match.group(0)

    return PLACEHOLDER_RE.sub(replace, text)


def request_translation(text: str, retries: int = 5) -> str:
    payload = urllib.parse.urlencode(
        {"client": "gtx", "sl": "ar", "tl": "en", "dt": "t", "q": text}
    ).encode("utf-8")
    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={
            "User-Agent": "Mozilla/5.0 AgriPedia-Translation/1.0",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        method="POST",
    )
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                result = json.loads(response.read().decode("utf-8"))
            return "".join(fragment[0] for fragment in result[0] if fragment[0])
        except Exception as exc:  # network failures are retried with backoff
            last_error = exc
            time.sleep(min(2 ** attempt, 12))
    raise RuntimeError(f"Translation request failed after {retries} attempts: {last_error}")


def translate_group(sources: list[str]) -> list[str]:
    protected: list[str] = []
    latin_values: list[list[str]] = []
    for source in sources:
        value, latin = protect_latin(source)
        protected.append(value)
        latin_values.append(latin)

    joined = f"\n{SEPARATOR}\n".join(protected)
    translated = request_translation(joined)
    parts = re.split(rf"\s*{re.escape(SEPARATOR)}\s*", translated)
    if len(parts) != len(sources):
        if len(sources) == 1:
            raise RuntimeError("The translation response did not preserve its separator")
        midpoint = len(sources) // 2
        return translate_group(sources[:midpoint]) + translate_group(sources[midpoint:])

    return [restore_latin(part.strip(), latin) for part, latin in zip(parts, latin_values)]


def collect_strings(tab: dict[str, Any]) -> list[str]:
    strings: list[str] = []
    for block in tab.get("content_blocks", []):
        for item in block.get("items", []):
            if isinstance(item.get("text"), str):
                strings.append(item["text"])
            for entry in item.get("items", []):
                if isinstance(entry, str):
                    strings.append(entry)
            for header in item.get("headers", []):
                if isinstance(header, str):
                    strings.append(header)
            for row in item.get("rows", []):
                if isinstance(row, list):
                    strings.extend(cell for cell in row if isinstance(cell, str))
                elif isinstance(row, dict):
                    strings.extend(value for value in row.values() if isinstance(value, str))
    return strings


def translate_missing(sources: list[str], cache: dict[str, str], max_chars: int) -> None:
    unique = list(dict.fromkeys(text for text in sources if text.strip() and text not in cache))
    total = len(unique)
    done = 0
    while unique:
        batch: list[str] = []
        chars = 0
        while unique:
            candidate = unique[0]
            cost = len(candidate) + (len(SEPARATOR) + 2 if batch else 0)
            if batch and chars + cost > max_chars:
                break
            batch.append(unique.pop(0))
            chars += cost
        results = translate_group(batch)
        cache.update(zip(batch, results))
        save_json(CACHE_PATH, cache)
        done += len(batch)
        print(f"Translated {done}/{total} new strings; cache={len(cache)}", flush=True)
        time.sleep(0.15)


def apply_cache(tab: dict[str, Any], cache: dict[str, str]) -> dict[str, Any]:
    result = copy.deepcopy(tab)
    for block in result.get("content_blocks", []):
        for item in block.get("items", []):
            if isinstance(item.get("text"), str):
                item["text"] = cache[item["text"]]
            if isinstance(item.get("items"), list):
                item["items"] = [cache[value] if isinstance(value, str) else value for value in item["items"]]
            if isinstance(item.get("headers"), list):
                item["headers"] = [cache[value] if isinstance(value, str) else value for value in item["headers"]]
            if isinstance(item.get("rows"), list):
                for row_index, row in enumerate(item["rows"]):
                    if isinstance(row, list):
                        item["rows"][row_index] = [cache[value] if isinstance(value, str) else value for value in row]
                    elif isinstance(row, dict):
                        item["rows"][row_index] = {
                            key: cache[value] if isinstance(value, str) else value
                            for key, value in row.items()
                        }
    return result


def shape(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: shape(item) for key, item in value.items()}
    if isinstance(value, list):
        return [shape(item) for item in value]
    return type(value).__name__


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-chars", type=int, default=2800)
    args = parser.parse_args()

    arabic = load_json(AR_PATH)
    english = load_json(EN_PATH)
    cache = load_json(CACHE_PATH) if CACHE_PATH.exists() else {}
    source_tabs = arabic["tabs"][2:5]
    all_sources = [text for tab in source_tabs for text in collect_strings(tab)]
    print(f"Source strings={len(all_sources)}, unique={len(set(all_sources))}, cached={len(cache)}")
    translate_missing(all_sources, cache, args.max_chars)

    titles = [
        "Scientific and Common Names",
        "Scientific Classification",
        "Origin and Global Spread",
    ]
    translated_tabs = []
    for title, source_tab in zip(titles, source_tabs):
        translated = apply_cache(source_tab, cache)
        translated["tab_title"] = title
        if shape(translated["content_blocks"]) != shape(source_tab["content_blocks"]):
            raise RuntimeError(f"Structure mismatch in {title}")
        if len(collect_strings(translated)) != len(collect_strings(source_tab)):
            raise RuntimeError(f"Text leaf count mismatch in {title}")
        translated_tabs.append(translated)

    english["tabs"] = english["tabs"][:2] + translated_tabs
    save_json(EN_PATH, english)
    print(f"Wrote {EN_PATH} with {len(english['tabs'])} ordered tabs")


if __name__ == "__main__":
    main()
