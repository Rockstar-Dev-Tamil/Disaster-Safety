# Red Zone Console

A decision-support interface for multi-hazard relocation planning, built for
Smart India Hackathon problem statement **26191** (Ministry of Home Affairs).
The intended user is an officer of a State Disaster Management Authority who
must identify at-risk habitations, place them in a relocation tier, and defend
that placement.

This document describes what the system contains, the data it uses, and the
methods applied to that data. It does not evaluate the system's performance,
and no accuracy or validation claims are made.

---

## 1. Scope

Two screens, deep-linkable by URL hash:

| Route | Screen | Contents |
|---|---|---|
| `#/` | National view | Habitation points across India with hazard scores, published susceptibility overlays, observed rainfall at a fixed event timestamp |
| `#/evac/<habitation-id>` | Evacuation workspace | Road-level map for one habitation: candidate relocation zones, route evaluation, statutory compliance |

The demonstration geography is Wayanad district, Kerala, at the timestamp of
the 30 July 2024 landslide event. A second habitation set for Kendrapara,
Odisha (coastal erosion) exists in `src/data/kendrapara.ts` but is not wired
into the current build.

---

## 2. Design position

Hazard zoning here is a **deterministic weighted overlay**, not a trained
model. The reason is procedural rather than statistical: a red-zone
declaration is contested by a District Collector, in court, and in the press,
so the officer must be able to state which factor at which weight produced a
given number. A learned model can be more predictive and still be unusable in
that setting.

Two consequences run through the codebase:

1. **Every score is accompanied by its factor table.** `derive()` in
   [src/data/sources.ts](src/data/sources.ts) computes
   `score = sum(normalised x weight)` and throws if the weights do not sum to
   1.0 within `1e-6`. Displayed components therefore always reconstruct the
   displayed total.
2. **Every figure carries provenance.** Each value is tagged with a
   `Provenance` record naming source, agency, method, resolution, citation,
   and either an assessment date or an observation timestamp. Status is one of
   `LIVE`, `PENDING_OVERLAY`, `STUB_M2`, `STUB_M4`, so unimplemented modules
   are visible rather than silently plausible.

A related decision: standing susceptibility (assessed on a date) and current
operational state (observed at a timestamp) are held as two separate scores
and are never combined into one number.

---

## 3. Data sources

### 3.1 Published hazard layers

| Layer | Publisher | Notes |
|---|---|---|
| Landslide susceptibility | Geological Survey of India, National Landslide Susceptibility Mapping | 1:50,000 sheets, supplied as KMZ |
| Flood landform / hazard | Kerala SDMA with NCESS | Supplied as KMZ |
| Flood inundation | National Remote Sensing Centre, ISRO | |
| Shoreline change | NCSCM, MoEFCC | Kendrapara set only |
| Storm surge | INCOIS | ADCIRC at 1-in-100-year return period; Kendrapara set only |

KMZ sources are converted by [scripts/kmz2geojson.py](scripts/kmz2geojson.py).
Ring geometry is simplified by Ramer-Douglas-Peucker at 5 decimal places; an
earlier 4-place rounding collapsed one waterbody feature.

### 3.2 Observed precipitation

NASA GPM IMERG V07B Final Run, half-hourly (`GPM_3IMERGHH`,
doi:10.5067/GPM/IMERG/3B-HH/07), retrieved over OPeNDAP with DAP4 constraint
expressions by [scripts/fetch-imerg.py](scripts/fetch-imerg.py). Values are
aggregated to three-hourly accumulations over the single 0.1 degree cell
centred at (76.15 E, 11.45 N), which contains Chooralmala, Mundakkai, Attamala
and Punchirimattom. Those four habitations consequently share one rainfall
figure.

The file is labelled *observed*, not *nowcast*: it reports what fell.

### 3.3 Forecast precipitation

ECMWF IFS HRES open data, retrieved by
[scripts/fetch-ecmwf.py](scripts/fetch-ecmwf.py) using GRIB `.index` files to
issue byte-range requests for individual fields. Accumulated precipitation is
differenced between steps to give per-interval totals.

### 3.4 Terrain and infrastructure

| Layer | Source | Encoding on the grid |
|---|---|---|
| Elevation | Copernicus GLO-30 DEM | metres x 10 |
| Slope | Horn operator on the DEM | degrees x 1 |
| Landslide class | GSI NLSM, rasterised | class x 80 |
| Flood landform | KSDMA, rasterised | class x 80 |
| Distance to road | OSM, distance transform | metres / 50 |
| Distance to town | OSM place nodes | metres / 200 |
| Land use | OSM landuse / natural tags | class x 40 |
| Protected areas | OSM boundary and leisure tags | binary, 255 |

All layers are co-registered on one grid: bounds 75.55-76.65 E, 11.20-12.15 N;
**1199 x 1058 cells at 100 m**. At that cell size one cell is exactly one
hectare, which the zone-area arithmetic relies on. Layers are stored as 8-bit
greyscale PNG (about 6 MB total in `public/terrain/`) and decoded client-side.

Roads are extracted from OpenStreetMap via Overpass
([scripts/export-roads.py](scripts/export-roads.py)) and built into a routing
graph by [scripts/build-roadgraph.py](scripts/build-roadgraph.py). The graph
carries **tertiary classification and above only**; see section 7.

---

## 4. Methods

### 4.1 Rainfall thresholds

IMD's "extremely heavy rainfall" boundary of 204.5 mm/24 h is gauge-calibrated.
Applied directly to the IMERG estimate for this cell it reports no exceedance
for the July 2024 event, because the satellite retrieval under-reads orographic
extremes in the Western Ghats. Rather than apply a threshold across that
mismatch, return levels are fitted to the cell's own record so that IMERG is
compared against IMERG:

- Gumbel (EV1) distribution, fitted by L-moments
- 26 annual maximum daily accumulations, monsoon seasons (Jun-Sep) 1998-2023
- The event year is excluded from the baseline, so the event cannot contribute
  to the threshold it is tested against

Fitted return levels (mm/24 h): 2 y 87.3, 5 y 112.9, 10 y 129.9, 25 y 151.3,
50 y 167.2, 100 y 183.0.

The trigger is terrain-conditioned: the return period required to raise an
alert varies by published susceptibility band (Very High 2 y, High 5 y,
Moderate 15 y, Low 50 y, Very Low 100 y), so identical rainfall produces
different states on different ground.

Regeneration: `scripts/fetch-imerg.py` then
[scripts/derive-thresholds.py](scripts/derive-thresholds.py). The output is a
generated file, `src/data/rainfall.ts`.

### 4.2 Candidate zone extraction

Implemented in [src/lib/zones.ts](src/lib/zones.ts) as
filter, cluster, floor, fit, rank.

**Filter.** Cells are excluded by rule, and each excluded cell records *which*
rule removed it (`EXCLUSION` codes: outside radius, landslide class, flood
landform, slope, drainage margin, no data, speckle, built-up, restricted use,
paddy, forest, protected area).

Two rule sets:

| Parameter | Short-term (`DEFAULT_RULES`) | Permanent (`PERMANENT_RULES`) |
|---|---|---|
| Operation radius | 30 km | 30 km |
| Max slope | 5 deg | 15 deg |
| Max landslide class | 2 (Medium) | 1 (Low) |
| Minimum zone area | 8 ha | 12 ha |
| Exclude built-up | yes | yes |
| Exclude paddy | yes | yes |
| Exclude forest | no | yes |
| Exclude protected | no | yes |

The 5 degree camp gradient follows Sphere; the 8 ha floor follows Sphere's
45 square metres per person for a habitation of about 1,880. The permanent set
excludes forest because diversion under the Forest (Conservation) Act 1980 is
not obtainable on a resettlement timeline, and protected areas under the
Wildlife Protection Act 1972.

`minDrainageMarginM` defaults to **0**, i.e. disabled. As a hard rule it is
self-defeating alongside a gradient limit: flat ground is by definition close
to its own local minimum, so the two rules jointly eliminate the land that
passes both. The published KSDMA flood landform layer is used instead.

**Clean.** Slope computed at 100 m from a 30 m DEM is noisy in the Ghats, so
the raw eligible mask contains isolated cells ringed by steep ground.
Morphological opening (erode then dilate) removes specks and filaments while
leaving solid patches at their original extent.

**Cluster.** Connected components on the cleaned mask.

**Fit.** Each cluster is drawn as an **ellipse** from the second moment of its
member cells, not as a polygon. The hazard sheets are 1:50,000 and the grid is
100 m; neither supports a parcel boundary. The ellipse states that eligible
ground clusters in a location, at roughly a size and orientation. At coarse
zoom levels, nearby clusters are merged by **leader clustering** with a bounded
diameter; single-linkage was tried first and chained the map into one
43,122 ha component. Merged clusters combine second moments by the
parallel-axis theorem rather than re-scanning cells.

**Rank.** `DEFAULT_WEIGHTS` = area 0.25, distance-to-origin 0.20,
distance-to-road 0.20, slope 0.15, distance-to-town 0.15, drainage 0.05. Area
is included because a mean over per-cell factors is size-blind: without it a
9 ha patch outranks a 113 ha patch on average slope and distance. Area
saturates at three times the requirement so arbitrarily large clusters do not
dominate. Per-cell scores, which colour the surface, omit the area term, since
area is a property of the cluster and not of the cell.

### 4.3 Route evaluation

Implemented in [src/lib/routing.ts](src/lib/routing.ts). Dijkstra with a binary
heap over the road graph; alternates are generated by penalising edges of
already-found routes.

Each edge is sampled at 50 m intervals against the hazard, flood and slope
rasters. The risk score is assembled from named components:

| Component | Contribution |
|---|---|
| Fraction of segment inside High Hazard Zone | x 90 |
| Fraction inside Medium Hazard Zone | x 45 |
| Fraction across flood landform | x 50 |
| Adjacent slope above 25 degrees | up to 28 |
| Carriageway class | tertiary 8, secondary 4 |

Components are held in an array and the stated drivers are *derived from* that
array, so the listed reasons always sum to the printed score. An earlier
version computed drivers from metre thresholds while the score used length
fractions; the worst segment in the network then scored 63.6 and reported "no
mapped hazard". The sampled-length denominator is floored at 100 m (one
analysis cell) so a 3 m segment cannot report a hazard fraction above 1.

Risk class: 4 if more than 100 m of High Hazard Zone or score at least 70;
otherwise 3 at 45, 2 at 20, else 1. Class derates travel speed (0.45, 0.65,
0.85, 1.00), with a further 0.8 factor for night operation.

**Routes are ranked on worst segment, then time, never on mean risk.** A mean
would conceal one impassable culvert inside 40 km of good road. If no route
clears the acceptable class, the interface says so and names the segments
requiring ground observation, rather than returning a best-of-bad route
silently.

Segments can be marked impassable in the interface, which triggers a replan.

### 4.4 Long-term evaluation

Implemented in [src/lib/longterm.ts](src/lib/longterm.ts). Structured around
the Cernea *Impoverishment Risks and Reconstruction* model's eight risks, and
tested against the Third Schedule of the RFCTLARR Act 2013.

Siting tests carry citable thresholds:

| Requirement | Threshold | Authority |
|---|---|---|
| Sub-health centre | 2 km | Third Schedule item 17 |
| Primary health centre | 5 km | Third Schedule item 18 |
| Primary school | 1 km | RTE Act 2009 |
| All-weather road | 2 km | Third Schedule item 1; Rural Access Index / SDG 9.1.1 |
| Public transport to growth centre | 5 km | Third Schedule item 11 |
| Burial ground | 5 km | Third Schedule item 12 |
| Place of worship | 3 km | Third Schedule item 21 |

Third Schedule items that are **construction obligations** rather than siting
tests (19 of them: drains, anganwadi, panchayat building and so on) are listed
separately. A site does not "have" a drain; the acquirer must build one.
Scoring a site as passing or failing on them would misrepresent both.

Factor weights: continuity with the origin administrative unit 0.25, health
0.15, road 0.15, livelihood 0.15, education 0.10, settlement 0.10, commons
0.10. Each factor is tagged in `FACTOR_BASIS` with the Cernea risk it
addresses and whether it is **measured** or **proxied**.

Capacity uses the Kerala plot norm of 7 cents (0.028328 ha) per household with
a 35% infrastructure overhead:
`households = floor(area_ha * 0.65 / 0.028328)`.

No composite "livability" score is produced. Of Cernea's eight risks, only
about a third are geospatially addressable, two can be proxied, and three
cannot be observed from any layer here; `UNADDRESSED_RISKS` and
`FIELD_SURVEY_REQUIRED` enumerate them explicitly. Tiered evidence
(measured, proxied, requires field survey) is reported instead of a single
number that would imply the unobservable had been observed.

### 4.5 Tier status

Relocation tiers are independent booleans, not an ordered scale. `TierStatus`
has three values: `FLAGGED`, `NOT_FLAGGED`, and `WITHHELD`, the last meaning
the criteria are met but no viable destination was found. Collapsing
`WITHHELD` into `NOT_FLAGGED` would report a siting failure as an absence of
risk.

---

## 5. Repository layout

```
src/
  data/
    schema.ts        wire types; every figure carries Provenance
    sources.ts       source registry and derive()
    rainfall.ts      GENERATED - IMERG observations and fitted return levels
    wayanad.ts       authored Wayanad habitations
    kendrapara.ts    authored Kendrapara habitations (not currently wired in)
    habitations.ts   habitation set; generated points use a seeded LCG
    factory.ts       factor-table construction for generated points
    published.ts     published-layer metadata
    layers.ts        map layer definitions
    explanations.ts  explanation text keyed by scope
  lib/
    terrain.ts       PNG raster decode, grid indexing, haversine
    zones.ts         candidate zone extraction, merging, shortlisting
    routing.ts       edge risk, Dijkstra, alternates, replanning
    longterm.ts      RFCTLARR / Cernea evaluation
    severity.ts      CVD-safe severity ramp
    format.ts        number formatting
  routes/
    MapView.tsx      national view
    EvacView.tsx     habitation evacuation workspace
  components/        panels, factor tables, map canvas, explanation dock
  styles/            design tokens and application CSS
scripts/             data preparation (see section 6)
public/terrain/      generated raster stack, road graph, boundaries, amenities
```

Colour is used only for data semantics. The severity ramp is monotonic in
CIE L* (approximately 38, 46, 58, 68, 76) so it survives greyscale printing and
common colour-vision deficiencies, and severity is encoded redundantly through
marker radius, stroke width, and a printed numeral.

---

## 6. Data preparation

Scripts are run manually and their outputs are committed under
`public/terrain/` and `src/data/`. They are not part of the application build.

| Script | Output |
|---|---|
| `kmz2geojson.py` | GSI / KSDMA KMZ to GeoJSON |
| `sample-published.mjs` | samples published layers at habitation points |
| `fetch-imerg.py` | IMERG half-hourly and daily archives (OPeNDAP) |
| `derive-thresholds.py` | Gumbel fit, writes `src/data/rainfall.ts` |
| `fetch-ecmwf.py` | IFS HRES fields via GRIB index byte ranges |
| `build-terrain.py` | DEM, slope, hazard, distance and land-use rasters |
| `export-roads.py` | Overpass road extraction |
| `build-roadgraph.py` | routing graph from road geometry |
| `build-longterm-layers.py` | protected areas, taluk boundaries, amenity points |
| `browser-probe.mjs` | headless screenshot and console check |

`fetch-imerg.py` requires a NASA Earthdata token at `.earthdata_token`, which
is gitignored and not committed.

Notes on retrieval that affect reproducibility:

- Overpass queries are cached per tile and use a 90 s timeout with a narrowed
  set of highway classes. An earlier configuration (district-wide
  `residential` and `unclassified`, 300 s x 3 attempts x 3 mirrors) could spend
  45 minutes on a single tile with nothing cached.
- ECMWF is fetched from the Google mirror; the AWS S3 endpoint returned
  sustained 503 throttling.
- Return-level fitting reads the full 26-year record. Early stopping on
  apparent convergence was tested and rejected: the estimate settled to within
  -2.8% at 12 years but moved 6% at year 16 when 2019 entered the sample. In
  extreme-value fitting, a quiet interval is not evidence of convergence.

---

## 7. Limitations

Stated plainly, because several of these affect how the outputs should be read.

**Rainfall.**

- Every habitation inside one 0.1 degree cell shares a single rainfall figure.
  At about 11 km, that cell spans the entire Chooralmala, Mundakkai and
  Attamala group.
- The IMERG estimate for this event is substantially below the corresponding
  gauge record. Return levels fitted to IMERG absorb the bias for comparison
  purposes but do not correct the underlying estimate.
- The ECMWF forecast for the event window (52.6 mm) is below the IMERG
  observation for the same window (106.2 mm), which is itself below the gauge
  record. Of the three products, only the terrain-derived susceptibility layer
  identifies this location as hazardous.

**Geometry and geocoding.**

- Chooralmala's recorded coordinate lies 551 m outside the nearest GSI High
  Hazard Zone polygon. The distance is recorded rather than resolved; the
  coordinate has not been adjusted to force a match.
- Some real-world sites are absent from OpenStreetMap in this district and
  therefore cannot be named by the system, even where the underlying terrain
  analysis marks their ground as eligible.
- Zone ellipses fitted to very large clusters cover a substantial proportion of
  ineligible ground within their bounds. The ellipse is a second-moment
  summary, not a boundary, and at large cluster sizes it summarises weakly.

**Routing.**

- The graph carries tertiary-classification roads and above. For the Wayanad
  case this leaves 4.59 km origin-to-network and 2.34 km network-to-zone
  unrouted. Those legs are drawn dashed and labelled, and their travel time is
  **not** included in the stated arrival time, which is therefore an
  underestimate. This is the weakest figure the interface displays.
- Edge risk is sampled against static rasters. There is no live road-condition
  input; blockages are entered manually.

**Scope.**

- Modules 2 and 4 have components marked `STUB_M2` and `STUB_M4`.
- Land records, encumbrance and ownership are represented in the schema but not
  populated from any register.
- The generated (non-authored) habitation points exist to give the national map
  realistic density. They carry complete, internally consistent factor tables,
  and the raw values shown are back-computed from the normalised score through
  the stated scale, but they are synthetic and are not observations.
- No validation against recorded outcomes has been performed, and none is
  claimed.

---

## 8. Building and running

Requires Node 18 or later.

```
npm install
npm run dev       # Vite dev server
npm run build     # tsc -b && vite build
npm run preview
```

Stack: Vite, React 18, TypeScript, MapLibre GL JS. Styling is plain CSS with
design tokens; no component library. Routing is hash-based.

The interface targets a minimum viewport width of 1024 px and is laid out for
1440 px and above; narrower viewports show a notice instead.

Data preparation scripts require Python 3 and are run separately from the
application build.

---

## 9. References

- Cernea, M. M. (1997). The Risks and Reconstruction Model for Resettling
  Displaced Populations. *World Development* 25(10).
- Right to Fair Compensation and Transparency in Land Acquisition,
  Rehabilitation and Resettlement Act, 2013, Third Schedule.
- Sphere Association (2018). *The Sphere Handbook: Humanitarian Charter and
  Minimum Standards in Humanitarian Response.*
- Right of Children to Free and Compulsory Education Act, 2009.
- Forest (Conservation) Act, 1980; Wildlife Protection Act, 1972.
- Hosking, J. R. M. (1990). L-moments: Analysis and Estimation of
  Distributions Using Linear Combinations of Order Statistics.
  *Journal of the Royal Statistical Society B* 52(1).
- Horn, B. K. P. (1981). Hill Shading and the Reflectance Map.
  *Proceedings of the IEEE* 69(1).
- Huffman, G. J. et al. (2023). GPM IMERG Final Precipitation L3 Half Hourly
  0.1 degree V07. NASA GES DISC. doi:10.5067/GPM/IMERG/3B-HH/07
- Geological Survey of India, National Landslide Susceptibility Mapping.
- SDG indicator 9.1.1, Rural Access Index.
