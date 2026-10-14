# ADR-0001 - Location Autocomplete Strategy: Local Open-Source Dataset vs. Google Places API

**Status:** Accepted

**Date:** 14-10-2026

**Author(s):** Daniel Junho (@djunho)

---

## Context

Issue [#86](https://github.com/djunho/daka/issues/86) addresses inconsistencies in the `user_location` (User Profile) and `listing_location` (Swap Listings) fields. Previously, these were unconstrained free-text fields, causing typos and inconsistencies (e.g., "Lisbon", "Lisboa", "Lx", "lisboa-pt") that make searching and distance-based filtering difficult.

The initial issue proposal suggested integrating the **Google Places Autocomplete API**.

However, several project constraints and operational trade-offs must be taken into account:
1. **Operational & Billing Liability:** The Google Places API requires an active Google Cloud billing account with a team member's linked credit card. Unlike Google OAuth (where credentials stay protected inside the backend), Places API keys must be delivered to the client-side browser bundle, exposing the team to unauthorized usage, financial liability, or billing quota exhaustion.
2. **Evaluation Fragility:** Relying on third-party metered APIs during 42 evaluations introduces brittle failure points (e.g., referrer restrictions, domain mismatches across evaluation IPs, quota limits, or network firewall constraints).
3. **Resilience & Offline Operation:** Evaluation environments or local development setups may have intermittent connectivity. The application should remain responsive and functional even without external geocoding network requests.
4. **Project Scope:** Daka (*"Toma-lá dá-cá"*) is explicitly focused on local barter (*trocas*) within Portugal, meaning the location domain is strictly bounded to Portuguese administrative divisions.

---

## Decision

We decided to use a **pre-compiled, static open-source dataset** of Portuguese administrative divisions (districts, municipalities, and parishes) stored directly in the frontend repository:

- Source: Open-source [geoapi.pt](https://github.com/scsx/geoapi_pt) database exports (derived from official **CAOP / DGT** and **INE DICOFRE** nomenclature).
- Dataset: `srcs/services/frontend/src/data/portugalLocations.json`.
- Tool: `srcs/tools/build_locations.py` (fetches, parses, fixes upstream Azores formatting edge cases, and compiles the dataset).
- Coverage: **308 concelhos** (municipalities) and **3,092 freguesias** (parishes) — 100% of Portugal's official administrative divisions post-2013 reform.

Client-side autocomplete searches this in-memory list with normalized accent-insensitive matching:
- When a municipality is matched: `"Concelho, Distrito"` (e.g., `"Guimarães, Braga"`).
- When a parish is matched: `"Freguesia, Concelho, Distrito"` (e.g., `"Creixomil, Guimarães, Braga"`).

---

## Alternatives Considered

### Alternative 1 - Google Places Autocomplete API
Proprietary service by Google Cloud Platform.

Advantages:
- Worldwide coverage, high quality fuzzy search.
- Official SDKs available.

Disadvantages:
- Requires Google Cloud account with active credit card billing (financial liability for the team).
- Frontend exposure of API keys (unlike backend OAuth credentials).
- Risk of breakage during evaluations due to quota limits, domain/referrer mismatches, or billing hiccups.
- Keystroke billing costs and proprietary vendor lock-in.
- Unnecessary complexity for static, publicly available Portuguese administrative data.

### Alternative 2 - Nominatim (OpenStreetMap Official Geocoder)
Public API hosted by the OpenStreetMap Foundation.

Advantages:
- Free and open-source data.
- Global coverage.

Disadvantages:
- Strictly prohibits keystroke "search-as-you-type" queries under its public usage policy.
- Hard rate limit of 1 request/second; aggressive IP blocking on automated or fast typing.
- Self-hosting via Docker requires downloading large OSM extracts (~1+ GB RAM).

### Alternative 3 - Photon by Komoot (Public Instance)
Open-source geocoder based on OSM and Elasticsearch.

Advantages:
- Designed specifically for search-as-you-type with fuzzy matching.
- Free public API without API keys (`photon.komoot.io`).

Disadvantages:
- Requires active external internet connectivity during evaluation.
- Subject to public instance latency and fair-use rate limiting.

### Alternative 4 - Local Pre-compiled Dataset (Chosen)
Static JSON compiled once during development and bundled with the frontend SPA.

Advantages:
- **Zero API keys & zero cost:** Completely free and open.
- **100% offline resilient:** Evaluators can run the project without internet access.
- **Instant search (<1ms):** In-memory array filtering in JavaScript with no network lag.
- **Lightweight:** Total uncompressed size ~620 KB, gzipped over HTTPS ~64 KB.
- **Total standardization:** Guaranteed canonical naming for all Portuguese locations.

Disadvantages:
- Limited to Portugal (acceptable given Daka's geographical scope).
- Static data requires running the generator script if municipal boundaries change in the future.

---

## Consequences

### Positive Consequences
- Guarantees compliance with 42 evaluation rules (single command launch, zero console errors, no paid external dependencies).
- Immediate, lag-free user experience during location selection.
- Provides clean, canonical data (`concelho` and `distrito`) for future proximity/filtering queries.

### Negative Consequences / Trade-offs
- **Client Asset Size:** Shipping the static JSON file adds ~620 KB uncompressed (~64 KB gzipped) to client assets.
  - *Mitigation:* The frontend must use dynamic imports (`await import(...)`) / code-splitting to lazy-load the dataset only when the user focuses on or enters a location input field, ensuring zero impact on initial page load (e.g. `/`, `/login`).
- **Geographical Boundary:** The dataset strictly covers Portugal (308 municipalities and 3,092 parishes). If Daka expands internationally in future milestones, an external fallback or global dataset will be required.
- **Static Maintenance:** If administrative boundaries change in Portugal, the dataset will not automatically update until the generator script is re-run.

### Future Improvements
- **Backend Search Endpoint (`GET /api/locations?q=...`):**
  If the dataset ever expands significantly (e.g., adding postal codes or streets) or if the team decides to eliminate the ~64 KB client asset entirely, the static dataset can be relocated to the FastAPI backend.
  - The backend can load the dataset once into memory or into a MariaDB fulltext/index table at startup.
  - The frontend would query `GET /api/locations?q={query}` with a ~300ms debounce, receiving only the top 5–8 matching records (< 1 KB payload per request).

---

## Implementation Notes

- **Data Generator:** `srcs/tools/build_locations.py`
  - Can be executed on demand: `python3 srcs/tools/build_locations.py [target_path]`.
  - Fixes 10 upstream edge cases in Azores parish notations to ensure 100% parsing success.
- **Compiled Dataset:** `srcs/services/frontend/src/data/portugalLocations.json` (3,400 entries).

---

## References

- [GitHub Issue #86](https://github.com/djunho/daka/issues/86)
- [CAOP — Carta Administrativa Oficial de Portugal (DGT)](https://www.dgterritorio.gov.pt/cartografia/cartografia-tematica/caop)
- [INE — Instituto Nacional de Estatística (DICOFRE)](https://www.ine.pt)
- [geoapi.pt GitHub Repository](https://github.com/scsx/geoapi_pt)
