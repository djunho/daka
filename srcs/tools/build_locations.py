#!/usr/bin/env python3
"""Build Portugal locations dataset from geoapi.pt open-source data.

This script fetches the official administrative division data (districts,
municipalities, and parishes) maintained by the geoapi.pt project
(https://github.com/scsx/geoapi_pt) and compiles it into a lightweight,
search-optimized JSON file for the Daka frontend autocomplete component.

Output structure:
[
  {
    "name": "Guimarães",
    "type": "concelho",
    "concelho": "Guimarães",
    "distrito": "Braga",
    "label": "Guimarães, Braga"
  },
  {
    "name": "Creixomil",
    "type": "freguesia",
    "concelho": "Guimarães",
    "distrito": "Braga",
    "label": "Creixomil, Guimarães, Braga"
  }
]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

# Upstream raw data URLs from the official geoapi.pt repository.
# Note on "geoapi_pt-Backups": The geoapi.pt project maintains a live JSON API
# (json.geoapi.pt) which enforces strict rate limits on free requests. To allow
# local development without hitting rate limits, the author committed static
# JSON database dumps/snapshots into the `geoapi_pt-Backups/` directory of the repo.
# We consume these static dumps directly to get complete, reliable data in one go.
GEOAPI_DISTRITOS_URL = (
    "https://raw.githubusercontent.com/scsx/geoapi_pt/main/data/"
    "geoapi_pt-Backups/distritos%20%2B%20municipios.json"
)
GEOAPI_FREGUESIAS_URL = (
    "https://raw.githubusercontent.com/scsx/geoapi_pt/main/data/"
    "geoapi_pt-Backups/freguesias.json"
)

# Known edge-case notations in geoapi.pt parish backup file (mostly Azores).
#
# Context & Rationale:
# In geoapi.pt's `freguesias.json`, parishes are generally stored as:
#   "Parish Name (Municipality Name)"
#
# However, 10 entries from the Azores (Ilha de São Miguel) have formatting quirks:
# 1. Ambiguity with "Lagoa":
#    Portugal has two municipalities named Lagoa (one in Faro/Algarve, one in Azores).
#    To disambiguate, geoapi.pt named the Azorean municipality "Lagoa (Açores)".
#    Because the municipality name itself contains parentheses, geoapi.pt's export
#    script produced malformed strings, such as an unclosed parenthesis:
#    `"Ribeira Chã (Lagoa (Açores)"`, and truncated entries where the municipality
#    name was omitted, leaving only the region: `"Cabouco (Açores)"` and
#    `"Água de Pau (Açores)"` (both are legally parishes of Lagoa).
# 2. Inverted/duplicated labels in Ponta Delgada:
#    Entries like `"Ponta Delgada (São José, Ponta Delgada)"` instead of `"São José (Ponta Delgada)"`.
#
# The geoapi.pt web app itself acknowledges this regex/parenthesis parser limitation
# in `app/freguesias/page.jsx` ("Quando há dois sets de parentesis não funciona bem...").
#
# This dictionary explicitly maps those 10 raw entries to their canonical, legally
# official (Parish, Municipality) tuples. The district is resolved directly from
# `muni_map` to ensure 100% consistency with the concelho entries.
AZORES_SPECIAL_CASES: dict[str, tuple[str, str]] = {
    "cabouco (açores)": ("Cabouco", "Lagoa (Açores)"),
    "água de pau (açores)": ("Água de Pau", "Lagoa (Açores)"),
    "ribeira chã (lagoa (açores)": ("Ribeira Chã", "Lagoa (Açores)"),
    "lagoa (nossa senhora do rosário, açores)": (
        "Nossa Senhora do Rosário",
        "Lagoa (Açores)",
    ),
    "lagoa (santa cruz, açores)": ("Santa Cruz", "Lagoa (Açores)"),
    "ponta delgada (são josé, ponta delgada)": ("São José", "Ponta Delgada"),
    "ponta delgada (são pedro, ponta delgada)": ("São Pedro", "Ponta Delgada"),
    "ponta delgada (são sebastião, ponta delgada)": (
        "São Sebastião",
        "Ponta Delgada",
    ),
    "ponta delgada (santa clara, ponta delgada)": (
        "Santa Clara",
        "Ponta Delgada",
    ),
    "ponta delgada (relva, ponta delgada)": ("Relva", "Ponta Delgada"),
}


def fetch_json(url: str) -> list | dict:
    """Fetch and decode JSON from a remote URL."""
    print(f"Fetching: {url}")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Daka-Build-Locations/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def build_locations() -> list[dict[str, str]]:
    """Build the consolidated Portugal locations list."""
    distritos_data = fetch_json(GEOAPI_DISTRITOS_URL)
    freguesias_data = fetch_json(GEOAPI_FREGUESIAS_URL)

    # 1. Map municipalities to districts and build concelho entries
    muni_map: dict[str, tuple[str, str]] = {}
    concelho_entries: list[dict[str, str]] = []

    for item in distritos_data:
        distrito = item["distrito"].strip()
        for muni in item["municipios"]:
            muni_name = muni["nome"].strip()
            # Canonicalize casing for Lagoa (Açores) to maintain proper capitalization
            if muni_name.lower() == "lagoa (açores)":
                muni_name = "Lagoa (Açores)"

            muni_map[muni_name.lower()] = (muni_name, distrito)

            concelho_entries.append(
                {
                    "name": muni_name,
                    "type": "concelho",
                    "concelho": muni_name,
                    "distrito": distrito,
                    "label": f"{muni_name}, {distrito}",
                }
            )

    # 2. Build freguesia entries
    freguesia_entries: list[dict[str, str]] = []
    unmatched: list[str] = []

    for entry in freguesias_data:
        raw = entry.strip()
        lower = raw.lower()

        if lower in AZORES_SPECIAL_CASES:
            freg_name, concelho_key = AZORES_SPECIAL_CASES[lower]
            concelho, distrito = muni_map[concelho_key.lower()]
            freguesia_entries.append(
                {
                    "name": freg_name,
                    "type": "freguesia",
                    "concelho": concelho,
                    "distrito": distrito,
                    "label": f"{freg_name}, {concelho}, {distrito}",
                }
            )
            continue

        if "(" in raw and raw.endswith(")"):
            freg_part, muni_part = raw[:-1].rsplit("(", 1)
            freg_name = freg_part.strip()
            muni_name = muni_part.strip()

            info = muni_map.get(muni_name.lower())
            if info:
                concelho, distrito = info
                freguesia_entries.append(
                    {
                        "name": freg_name,
                        "type": "freguesia",
                        "concelho": concelho,
                        "distrito": distrito,
                        "label": f"{freg_name}, {concelho}, {distrito}",
                    }
                )
            else:
                unmatched.append(raw)
        else:
            unmatched.append(raw)

    if unmatched:
        sample = "\n".join(f"  - {item}" for item in unmatched[:10])
        raise RuntimeError(
            f"Failed to match {len(unmatched)} freguesias with municipalities.\n"
            f"Sample unmatched entries:\n{sample}"
        )

    print(f"Loaded {len(concelho_entries)} concelhos.")
    print(f"Loaded {len(freguesia_entries)} freguesias.")

    # Concelhos first, followed by freguesias
    return concelho_entries + freguesia_entries


def parse_target_path() -> Path:
    """Parse output path from CLI arguments, defaulting to current working directory."""
    parser = argparse.ArgumentParser(
        description=(
            "Fetch and build Portugal locations dataset (concelhos & freguesias) "
            "from geoapi.pt raw data."
        )
    )
    parser.add_argument(
        "output",
        nargs="?",
        default=None,
        help=(
            "Destination file or directory path. If omitted, saves "
            "`portugalLocations.json` in the current working directory."
        ),
    )
    args = parser.parse_args()

    if args.output:
        raw_path = Path(args.output).expanduser()
        # If user passed an existing directory or trailing slash, append filename
        if raw_path.is_dir() or args.output.endswith(("/", "\\")):
            return raw_path.resolve() / "portugalLocations.json"
        return raw_path.resolve()

    return (Path.cwd() / "portugalLocations.json").resolve()


def main() -> int:
    target_path = parse_target_path()

    locations = build_locations()
    target_path.parent.mkdir(parents=True, exist_ok=True)

    with open(target_path, "w", encoding="utf-8") as f:
        json.dump(locations, f, ensure_ascii=False, indent=2)

    file_size_kb = target_path.stat().st_size / 1024
    print(f"\nSuccessfully generated: {target_path}")
    print(f"Total entries: {len(locations)}")
    print(f"File size: {file_size_kb:.1f} KB")

    return 0


if __name__ == "__main__":
    sys.exit(main())
