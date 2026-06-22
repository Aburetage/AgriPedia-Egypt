#!/usr/bin/env python3
"""Terminology QA for the English morphological-description chapter."""

import json
from pathlib import Path
from typing import Any


PATH = Path(__file__).resolve().parents[1] / "data" / "en" / "tuta" / "5.json"

REPLACEMENTS = [
    ("tunneling flies", "leafminer flies"),
    ("complete transformation", "complete metamorphosis"),
    ("Complete transformation", "Complete metamorphosis"),
    ("Caterpillar", "Larva"),
    ("caterpillar", "larva"),
    ("Virgins", "Pupae"),
    ("Virgo", "Pupa"),
    ("adult insect or mite", "adult insect or moth"),
    ("diagnosing the lesion", "identifying the pest"),
    ("tunnel makers", "leafminers"),
    ("Tunnel makers", "Leafminers"),
    ("tunnels", "mines"),
    ("Tunnels", "Mines"),
    ("tunnel", "mine"),
    ("Tunnel", "Mine"),
    ("the waste", "frass"),
    ("waste inside", "frass inside"),
    ("pectoral shield", "prothoracic shield"),
    ("larval ages", "larval instars"),
    ("larval age", "larval instar"),
    ("full moth", "adult moth"),
    ("raspberry moths", "Tuta moths"),
    ("The lesion appears", "The pest appears"),
    ("image of the lesion alone", "visible damage alone"),
    ("Infection of tops and fruits", "Infestation of growing tips and fruits"),
    ("Irregular macular mines", "Irregular blotch-like mines"),
    ("mouth parts", "mouthparts"),
    ("vital function", "biological function"),
    ("; Because", " because"),
    ("; because", " because"),
]

EXACT = {
    "The position of Pupa and the nature of the surrounding atmosphere.": "The position of the pupa and the nature of its surrounding covering or cocoon.",
    "Complete moth form.": "Adult moth morphology.",
    "The infection is transmitted between plants and fields.": "It spreads the infestation between plants and fields.",
    "Each instar is separated from the last molt, during which the larva gets rid of the old outer covering, until the new covering allows the body to increase in size.": "Successive larval instars are separated by molts, during which the larva sheds its old outer covering so the body can increase in size.",
    "After completing the fourth larval instar, the larvae stops feeding, begins the pre-pupation stage, and then turns into a pupa.": "After completing the fourth larval instar, the larva stops feeding, enters the prepupal stage, and then becomes a pupa.",
    "Identifying the insect begins from the smallest to the largest instar:": "Identification proceeds through the life stages from smallest to largest:",
    "The transition between these phases does not merely represent a gradual increase in size; Each stage differs from the other in its body structure, behavior, location on the plant, and its role within the life cycle.": "The transition between these stages is not merely a gradual increase in size; each stage differs in body structure, behavior, location on the plant, and role within the life cycle.",
}


def refine(value: Any) -> Any:
    if isinstance(value, str):
        result = value
        for old, new in REPLACEMENTS:
            result = result.replace(old, new)
        return EXACT.get(result, result)
    if isinstance(value, list):
        return [refine(item) for item in value]
    if isinstance(value, dict):
        return {key: refine(item) for key, item in value.items()}
    return value


data = json.loads(PATH.read_text(encoding="utf-8"))
PATH.write_text(json.dumps(refine(data), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Refined English terminology in chapter six")
