#!/usr/bin/env python3
"""Translate one standalone Arabic chapter-tab JSON while preserving its shape."""

from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("tab_translator", Path(__file__).with_name("translate-tuta-chapters.py"))
translator = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(translator)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("destination")
    parser.add_argument("--title", required=True)
    parser.add_argument("--max-chars", type=int, default=2800)
    args = parser.parse_args()

    source = translator.load_json(Path(args.source))
    cache = translator.load_json(translator.CACHE_PATH) if translator.CACHE_PATH.exists() else {}
    strings = translator.collect_strings(source)
    print(f"Source strings={len(strings)}, unique={len(set(strings))}, cached={len(cache)}", flush=True)
    translator.translate_missing(strings, cache, args.max_chars)
    translated = translator.apply_cache(source, cache)
    translated["tab_title"] = args.title
    if translator.shape(translated["content_blocks"]) != translator.shape(source["content_blocks"]):
        raise RuntimeError("Translated tab structure mismatch")
    if len(translator.collect_strings(translated)) != len(strings):
        raise RuntimeError("Translated tab text count mismatch")
    translator.save_json(Path(args.destination), translated)
    print(f"Wrote {args.destination}")


if __name__ == "__main__":
    main()
