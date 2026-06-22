#!/usr/bin/env python3
"""Apply deterministic terminology QA to machine-translated Tuta chapters 3-5."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


PATH = Path(__file__).resolve().parents[1] / "data" / "en" / "tuta.json"

REPLACEMENTS = [
    ("ZXQLAT 0005ZXQ", "Gelechioidea"),
    ("Mulberry", "Tuta"),
    ("mulberry", "Tuta"),
    ("raspberries", "Tuta"),
    ("raspberry", "Tuta"),
    ("Tota", "Tuta"),
    ("tota", "Tuta"),
    ("thymus", "Tuta"),
    ("true mite", "true weevil"),
    ("True mite", "True weevil"),
    ("Virgin Tuta", "Tuta pupa"),
    ("Count the berries", "Count Tuta adults"),
    ("full-fledged winged insect", "winged adult"),
    ("names of the lesion", "names of the pest"),
    ("refers to the lesion", "refers to the pest"),
    ("identity of the lesion", "identity of the pest"),
    ("type of lesion", "type of pest"),
    ("similar lesions", "similar pests"),
    ("the lesion spreads", "the pest spreads"),
    ("the lesion has reached", "the pest has reached"),
    ("the lesion becomes", "the pest becomes"),
    ("old lesion", "old infestation"),
    ("fruit lesions", "fruit damage"),
    ("infection-free nurseries", "pest-free nurseries"),
    ("infection", "infestation"),
    ("Infection", "Infestation"),
    ("tunnel maker flies", "leafminer flies"),
    ("Tunnel maker flies", "Leafminer flies"),
    ("Tunnel Maker Flies", "Leafminer Flies"),
    ("tunnel makers", "leafminers"),
    ("Tunnel makers", "Leafminers"),
    ("tunnel maker", "leafminer"),
    ("Tunnel maker", "Leafminer"),
    ("Live miners", "Leafminers"),
    ("dig stems, tops, and fruits", "mine stems, growing tips, and fruits"),
    ("Dig out the tops and stems", "Mine growing tips and stems"),
    ("First registration", "First record"),
    ("first official registration", "first official record"),
    ("first registration", "first record"),
    ("Spanish registration", "Spanish record"),
    ("first recording", "first record"),
    ("First European recording", "First European record"),
    ("These recordings", "These records"),
    ("recording location", "record location"),
    ("years of recording", "recorded years"),
    ("recording individuals or outposts", "records of individuals or localized foci"),
    ("outposts", "localized foci"),
    ("Stability in the Mediterranean climate", "Establishment in the Mediterranean climate"),
    ("to their stability", "for its establishment"),
    ("course of the conquest", "course of the invasion"),
    ("speed of global conquest", "speed of the global invasion"),
    ("tomatoes and nightshade families", "tomatoes and other solanaceous crops"),
    ("ability of a butterfly to fly naturally", "natural flight range of the moth"),
    ("then butterflies and local crop movements", "then adult moths and local crop movements"),
    ("several cultures", "several farms"),
    ("economic seriousness", "economic severity"),
    ("scientific papers, extensions,", "scientific papers, extension publications,"),
    ("; Because", " because"),
    ("; because", " because"),
    (".)).", ")."),
    ("Taxonomy)).", "Taxonomy)."),
    ("..", "."),
]

EXACT = {
    "The expression “Tuta moth” is more accurately entomological than the expression “Tuta moth,” even though the two expressions are understandable in field use.":
        "The term “Tuta moth” is entomologically more accurate than “Tuta butterfly,” although both expressions are understood in field use.",
    "Confusing Tuta flies with leafminers may lead to:":
        "Confusing Tuta with leafminer flies may lead to:",
    "No Tuta pheromone is used":
        "No Tuta pheromone is used for this pest",
    "Used for Tuta":
        "Used for Tuta monitoring",
    "The Tuta is a Lepidoptera insect, while the true weevil belongs to the Coleoptera.":
        "Tuta is a lepidopteran insect, whereas true weevils belong to the order Coleoptera.",
    "The true weevil is a beetle of Coleoptera.":
        "A true weevil is a beetle of the order Coleoptera.",
    "The description of South American reduces confusion with other types of leafminers.":
        "The descriptor “South American” reduces confusion with other leafminer species.",
    "The shape of the tunnel alone does not determine the identity of the pest in all cases, especially at the beginning of the infestation or when several tunnels overlap.":
        "Mine shape alone does not identify the pest in every case, especially early in an infestation or when several mines overlap.",
    "A distinction must be made between the actual date of introduction of the insect and the date of its first official record. The pest may reach a specific area and remain in limited numbers for several weeks or months before it is discovered and diagnosed. Therefore, the recorded years given in this chapter represent the date of the first documented discovery, and do not always prove the exact date of the first individual's arrival in the country.":
        "A distinction must be made between the insect’s actual introduction date and its first official record. The pest may reach an area and remain at low numbers for weeks or months before it is detected and diagnosed. The record years cited in this chapter therefore represent the first documented detection and do not always prove the exact date on which the first individual entered the country.",
    "This table shows selected stations, and does not represent a complete list of each country or first record location.":
        "This table presents selected milestones and is not a complete list for every country or first-record location.",
    "When fruit damage appear on a large scale, the pest has already established itself. Therefore, monitoring begins with trapping and examining plants before losses appear.":
        "When fruit damage appears on a large scale, the pest is already established. Monitoring should therefore begin with traps and plant inspection before losses appear.",
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
data["tabs"][2:5] = refine(data["tabs"][2:5])
PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Refined English terminology in chapters 3-5")
