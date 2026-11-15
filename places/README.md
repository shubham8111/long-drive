# Adding a place

One small file plus one command.

1. Copy an existing file (real files are plain JSON: no `//` comments) in this folder (e.g. `paris.json`) to `places/<id>.json` and edit it.
2. Run `npm run place <id>`.
3. Reload the game: the new place appears under "Place" on the start screen.

`npm run place all` rebuilds everything. Everything it downloads is kept for good
(`data/` for raw map data, `public/routes` and `public/world` for the built place).

Every place is a fixed route, so the map tiles it can ever show are known exactly (`scripts/tileplan.mjs`
walks the game's own tile rule, `src/tiles.js`, along the route). `npm run prune` reports what in
`data/tiles` no place needs (e.g. imagery the tree baker read once); `npm run prune -- --apply` deletes
it and stores the rest compact (WebP). Rebuilding a place downloads whatever its build reads again.

## The file

```json
{
  "id": "paris",                      // file name, letters/digits only
  "name": "Champs-Élysées to Notre-Dame",
  "region": "Paris",
  "short": "Paris",                   // label on the start-screen button
  "blurb": "One line shown on the start screen.",
  "kind": "city",                     // "scenic" | "city" | "circuit"
  "source": { "type": "osrm", "points": [[2.2975, 48.8732], [2.3170, 48.8668]] },
  "stops": [
    { "name": "Arc de Triomphe", "at": "start" },
    { "name": "The Louvre", "lat": 48.8597, "lon": 2.3376 }
  ]
}
```

### `source` — where the road comes from
- `{"type": "osrm", "points": [[lon, lat], ...]}` — a real driving route through these points
  (start, any number of via points, end). Coordinates are **longitude first**. The router obeys
  one-way streets; if the build prints "sharp reversal", a via point snapped to a side street —
  nudge it onto the road you meant.
- `{"type": "geojson", "url": "https://…"}` or `{"type": "geojson", "file": "my-line.geojson"}` —
  any GeoJSON line, e.g. a race circuit. Add `"reverse": true` to drive it the other way.
- `{"type": "line", "points": [[lon, lat], ...]}` — a hand-drawn line.

### `kind` — sensible defaults for look and feel
| kind | road | scenery |
|---|---|---|
| `scenic` | two-lane highway, yellow centre line | pines, shrubs, rocks, natural ground |
| `city` | wide multi-lane street, dashed white lines | street/park trees, buildings, paved ground |
| `circuit` | wide track, white edge lines, car on the centre line | trees, buildings, natural ground |

### Optional
- `"loop": true` — closed circuit (the end joins the start).
- `"leftHand": true` — drive on the left (UK, Japan, …).
- `"origin": {"lat": .., "lon": ..}` — centre of the local map; worked out automatically if absent.
- `"road": {"half": 8, "style": "city", "lane": 1.9}` — override width (half-width in metres,
  including shoulders), markings (`highway` / `city` / `track`) and the car's lane offset.
- `"scenery": {"trees": "pine" | "broadleaf" | false, "shrubs": false, "rocks": false,
  "ground": "wild" | "paved", "buildings": true, "radius": 600}` — override the kind's defaults.
  - `"streetTrees": 0.25` (city) — fraction of trees kept within road half-width + 9 m of the route; those are
    also 30 % smaller (real avenues have few, small street trees).
  - `"parks": [{"lat": .., "lon": .., "r": 150}, {"north": 40.7644}]` — areas exempt from `streetTrees`
    (full-size, full-density trees): circles, or everything north of a latitude.
  - `"ecology": {...}` (scenic, used by Bryce) — switches on the elevation-aware tree baker in `scripts/build-world.mjs`
    (without it the baker is unchanged). Species follow the baked ground elevation with noisy, ragged boundaries:
    juniper/pinyon woodland below `bands[0]` (default 2250 m), open ponderosa parkland with glades up to `bands[1]` (2500),
    ponderosa + Douglas/white fir + aspen groves up to `bands[2]` (2650), spruce/fir above. Keys:
    `bands: [m, m, m]`, `elevJitter` (m of noise on the elevation), `clear: [min, max]` (road setback in metres,
    varies along the road and per side; the odd tree is allowed closer), `redCanyon: {s: [from, to], density, clear}`
    (route metres; sparse trees, wide setback), `openSections: [{s: [from, to], density}]` (density multipliers for
    meadows), `keepClear: [{s, r, lateral}]` (no trees within r route-metres of s and `lateral` m, default 70, of the road).
  - `"vistas": [{"lat": .., "lon": .., "r": 70, "ext": 150}]` (needs `ecology`) — overlook view wedges. The baker finds
    the steepest drop east of the point (bearings 30-150) and clears trees and big rocks in a fan `r` m either side
    (widening slightly) from the road out to `ext` m past the point; edges are thinned, not cut. Printed during the bake.
  - `"rimGlimpse": {"s": [from, to], "rim": 150, "drop": 20, "reach": 90, "keep": 0.35}` (needs `ecology`) — where the
    ground east of the road drops more than `drop` m within `rim` m, only a fraction `keep` of trees within `reach` m survive.
- `facts` — short TRUE things the radio announcer says as you pass: `{"lat": .., "lon": .., "text": "..."}`
  (or `"texts": ["...", "..."]`: several about the same landmark, one picked at random each time)
  or `{"frac": 0.5, "text": "..."}` (half-way along). Written to be spoken: no abbreviations.
- `stops` — named places for "Begin at / Jump to" and for the radio announcer. `"at": "start"` /
  `"at": "end"` or a `lat`/`lon` near the road.

## Data sources (all open)
Roads: OpenStreetMap via OSRM. Elevation: Mapzen/AWS terrain tiles. Imagery: Esri World Imagery.
Buildings: OpenStreetMap. F1 circuit lines: github.com/bacinger/f1-circuits (MIT).
