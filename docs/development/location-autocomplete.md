# Location Autocomplete & Portugal Dataset

This document explains the location autocomplete architecture in Daka, detailing the static Portugal dataset, the generator script, and how the frontend consumes it.

---

## 1. Overview

In Daka (*"Toma-lá dá-cá"*), location input fields (`user_location` in user profiles and `listing_location` in swap items) require standardized city and parish names to enable accurate searching, sorting, and future proximity filtering.

Instead of relying on commercial or rate-limited external APIs (such as Google Places or Nominatim), Daka uses a **self-contained, offline-first dataset** covering 100% of Portugal's official administrative divisions.

See [ADR-0001](../adr/0001-location-autocomplete-strategy.md) for the architectural decision rationale.

---

## 2. Dataset Specification

The compiled dataset is stored at:
[`srcs/services/frontend/src/data/portugalLocations.json`](../../srcs/services/frontend/src/data/portugalLocations.json)

### Schema & TypeScript Interface

```typescript
export type LocationType = 'concelho' | 'freguesia'

export interface LocationItem {
  name: string       // Canonical name of the municipality or parish
  type: LocationType // 'concelho' for municipalities, 'freguesia' for parishes
  concelho: string   // Parent municipality name
  distrito: string   // Parent district or autonomous region
  label: string      // Formatted display string saved in the database
}
```

### Examples

**Municipality entry (`concelho`):**
```json
{
  "name": "Guimarães",
  "type": "concelho",
  "concelho": "Guimarães",
  "distrito": "Braga",
  "label": "Guimarães, Braga"
}
```

**Parish entry (`freguesia`):**
```json
{
  "name": "Creixomil",
  "type": "freguesia",
  "concelho": "Guimarães",
  "distrito": "Braga",
  "label": "Creixomil, Guimarães, Braga"
}
```

### Key Metrics
- **Concelhos (Municipalities):** `308` (100% of Portugal)
- **Freguesias (Parishes):** `3,092` (official CAOP post-2013 reform)
- **Total entries:** `3,400`
- **File size:** ~620 KB uncompressed, **~64 KB gzipped** over HTTPS

---

## 3. Dataset Generator (`build_locations.py`)

The dataset is generated via a Python script located at:
[`srcs/tools/build_locations.py`](../../srcs/tools/build_locations.py)

### How It Works
1. Fetches raw database snapshots from the open-source [`scsx/geoapi_pt`](https://github.com/scsx/geoapi_pt) repository:
   - `distritos + municipios.json` (districts and 308 municipalities with INE codes)
   - `freguesias.json` (3,092 parishes mapped to municipalities)
2. Normalizes municipality names and associates each municipality with its official district.
3. Maps each parish to its municipality and district.
4. Corrects 10 upstream edge cases in Azores parish records (caused by nested parentheses in the municipality name `"Lagoa (Açores)"` and inverted entries in Ponta Delgada).
5. Exports the compiled JSON to the designated output path.

### Usage

```bash
# Save to current working directory (default: ./portugalLocations.json)
python3 srcs/tools/build_locations.py

# Save directly to the frontend data directory
python3 srcs/tools/build_locations.py srcs/services/frontend/src/data/

# Specify an explicit target filename
python3 srcs/tools/build_locations.py srcs/services/frontend/src/data/portugalLocations.json

# Display help
python3 srcs/tools/build_locations.py --help
```

---

## 4. Frontend Integration Guidelines

### 4.1. Fast In-Memory Search

Filtering 3,400 items in client memory takes `< 1 ms` in modern JavaScript engines. To provide a smooth search-as-you-type experience:

1. **Accent-Insensitive Normalization:**
   Users frequently type without diacritics (e.g. `"guimaraes"` or `"agueda"`). Strip diacritics before matching:
   ```typescript
   function normalize(str: string): string {
     return str
       .normalize('NFD')
       .replace(/[\u0300-\u036f]/g, '')
       .toLowerCase()
   }
   ```

2. **Prioritize Municipalities over Parishes:**
   When a user types `"Guimarães"`, both the municipality `"Guimarães, Braga"` and its parishes (e.g. `"Creixomil, Guimarães, Braga"`) match. Display the `concelho` at the top of the suggestions.

3. **Limit Dropdown Results:**
   Limit visible suggestions to 6–8 items to maintain a clean UI and avoid DOM bloat:
   ```typescript
   const matches = locations
     .filter((item) => normalize(item.label).includes(normalizedQuery))
     .sort((a, b) => {
       // Concelhos first
       if (a.type !== b.type) return a.type === 'concelho' ? -1 : 1
       return a.name.localeCompare(b.name)
     })
     .slice(0, 8)
   ```

4. **Minimum Character Threshold:**
   Start filtering only after the user types at least **2 or 3 characters** to avoid displaying overwhelming lists.

5. **Keyboard & Selection Support:**
   Allow users to navigate suggestions using arrow keys (`ArrowDown`, `ArrowUp`), select with `Enter`, or dismiss with `Escape`.

### 4.2. Lazy Loading (Recommended)

To avoid bundling the static JSON (~64 KB gzipped) into the initial application chunk (`index.js`), load the dataset dynamically on demand:

```typescript
// Dynamically load only when user focuses the location input
let cachedLocations: LocationItem[] | null = null

export async function getPortugalLocations(): Promise<LocationItem[]> {
  if (!cachedLocations) {
    const mod = await import('../data/portugalLocations.json')
    cachedLocations = mod.default as LocationItem[]
  }
  return cachedLocations
}
```

---

## 5. Future Improvements

### Backend Search Endpoint (`GET /api/locations?q=...`)
As an architectural evolution, the dataset can be shifted to the backend if:
1. The dataset expands (e.g. adding postal codes or streets).
2. The team wants to achieve a zero-footprint client asset.

Implementation outline:
- Mount a route in FastAPI: `GET /api/locations?q={query}`.
- Cache the parsed JSON in backend memory or MariaDB table on server startup.
- The frontend issues debounced requests (~300ms) and receives only the top matches (< 1 KB payload).

---

## 6. Related Links & Issues

- [GitHub Issue #86 — Frontend: Location Autocomplete](https://github.com/djunho/daka/issues/86)
- [ADR-0001 — Location Autocomplete Strategy](../adr/0001-location-autocomplete-strategy.md)
- [CAOP / DGT — Official Administrative Map of Portugal](https://www.dgterritorio.gov.pt/cartografia/cartografia-tematica/caop)
- [GeoAPI.pt Repository](https://github.com/scsx/geoapi_pt)
