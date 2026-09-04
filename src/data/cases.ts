/* ============================================================================
 * EVENT CASES
 *
 * The console was built around one event: Wayanad, 30 Jul 2024. Almost nothing
 * about it was actually Wayanad-specific except three things -- the operating
 * clock, which authored habitation is the subject, and which pre-computed
 * terrain stack the evacuation workspace loads. This file makes those three
 * an explicit, switchable record instead of module constants.
 *
 * A case is an EVENT, not a place. It fixes a moment as well as a geography,
 * because every operational figure in the console is read at a timestamp: the
 * rainfall, the alert state, the current score. Switching case moves the clock.
 *
 * WHAT A CASE DOES NOT CHANGE
 * ---------------------------
 * The national view still plots every habitation in the set. The pan-India
 * picture is the pan-India picture; a case selects which event is being worked,
 * not which parts of the country exist.
 *
 * HONEST ABOUT WHAT IS MISSING
 * ----------------------------
 * `stack` is null when a case has no pre-computed terrain stack. The
 * evacuation workspace then refuses to open and says why, rather than fetching
 * another case's rasters and silently analysing the wrong ground. Given the
 * grid is a fixed bounding box, that failure would otherwise be invisible --
 * every number would compute, and every one of them would be about Kerala.
 * ==========================================================================*/

import type { HazardType } from './schema';
import { WAYANAD_CLOCK } from './wayanad';
import { KENDRAPARA_CLOCK } from './kendrapara';

export type CaseId = 'WAYANAD' | 'KENDRAPARA' | 'ASSAM';

export interface TerrainStackRef {
  /** Directory under public/ holding manifest.json and the raster set. */
  base: string;
  /** Tile template for the relief view's raster-dem source. */
  demTiles: string;
  /** [W, S, E, N] -- must match the manifest, and bounds the DEM requests. */
  bounds: [number, number, number, number];
  /** Attribution for whatever produced the elevation. */
  demAttribution: string;
  /** Short credit for the hazard sheets, for the map attribution control. */
  hazardAttribution: string;
  /** Optional XYZ template for a hazard raster drawn on the evacuation map.
   *  Tiles rather than a single image, because the evacuation map runs with
   *  terrain and a draped image source does not survive that path here. */
  hazardTiles?: string;
  /** Zoom the hazard pyramid was built to. */
  hazardTilesMaxZoom?: number;
  /** The accuracy caveat under the constraint-layer legend. Per-case because
   *  the sheets differ per AOI: asserting "KSDMA sheets at 1:50,000" over a
   *  scraped Assam flood composite would credit a Kerala agency for a raster
   *  it did not publish. */
  hazardNote: string;
}

export interface CaseDef {
  id: CaseId;
  /** Short name for the selector. */
  label: string;
  region: string;
  hazard: HazardType;
  /** Operating picture timestamp. Every operational figure is read here. */
  clock: string;
  /** What happened, in one line, for the case strip. */
  event: string;
  /** Authored habitation the case is about, if one exists. */
  focusId: string | null;
  /** Null when no terrain stack has been built for this AOI. */
  stack: TerrainStackRef | null;
  /** Shown when `stack` is null: what is missing and what it would take. */
  unavailable?: string;
  /** True when the case has no fixed event date and wants live feeds. */
  live?: boolean;
}

/* --------------------------------------------------------------- registry */

export const CASES: CaseDef[] = [
  {
    id: 'WAYANAD',
    label: 'Wayanad',
    region: 'Wayanad, Kerala',
    hazard: 'LANDSLIDE',
    clock: WAYANAD_CLOCK,
    event: 'Debris flow, Chooralmala and Mundakkai, 30 July 2024',
    focusId: 'WYD-CHOORALMALA',
    stack: {
      base: '/terrain',
      demTiles: '/dem/{z}/{x}/{y}.png',
      bounds: [75.55, 11.2, 76.65, 12.15],
      demAttribution: 'Elevation: Copernicus GLO-30',
      hazardAttribution: 'Hazard: KSDMA',
      hazardNote:
        'KSDMA sheets at 1:50,000 — boundaries good to 50–100 m. Not parcel-accurate.',
    },
  },
  {
    id: 'KENDRAPARA',
    label: 'Kendrapara',
    region: 'Kendrapara, Odisha',
    hazard: 'COASTAL_EROSION',
    clock: KENDRAPARA_CLOCK,
    event: 'Chronic shoreline retreat, Satabhaya–Kanhupur, 2024 season',
    focusId: 'KDP-KANHUPUR',
    stack: null,
    unavailable:
      'No terrain stack has been built for this area of interest. The '
      + 'evacuation workspace reads a fixed 100 m grid, and the one that ships '
      + 'covers 75.55–76.65 E — roughly 1,100 km west of here.',
  },
  {
    id: 'ASSAM',
    label: 'Assam',
    region: 'Brahmaputra valley, Assam',
    hazard: 'FLOOD',
    /* No fixed clock: this case is defined by "now", which is the whole point
     * of it. Held as an empty string so nothing renders a stale timestamp. */
    clock: '',
    event: 'Brahmaputra flooding — live, no fixed event timestamp',
    focusId: null,
    stack: {
      base: '/terrain-assam',
      demTiles: '/dem-assam/{z}/{x}/{y}.png',
      /* Majuli island and the districts immediately around it -- Lakhimpur and
       * Dhemaji on the north bank, Jorhat and Sivasagar on the south. Tighter
       * than a 30 km operation radius would suggest, because the Brahmaputra
       * here is 10 km wide in places: widening the box mostly buys river.
       *
       * The south edge is set by the operation radius, not by tidiness: at
       * 26.70 the 30 km search circle around Majuli was cut 6.1 km short and
       * lost 5.3 per cent of its area, which showed on the map as a straight
       * line across the bottom of the search disc. */
      bounds: [93.85, 26.60, 94.75, 27.40],
      demAttribution: 'Elevation: Copernicus GLO-30',
      hazardAttribution: 'Hazard: WRI Aqueduct flood return periods',
      hazardTiles: '/floodrp-assam/{z}/{x}/{y}.png',
      hazardTilesMaxZoom: 10,
      hazardNote:
        'Flood susceptibility is WRI Aqueduct, classed by the smallest return '
        + 'period that inundates each cell; the permanent tier excludes ground '
        + 'inside the 1-in-100. Native ~900 m, resampled to the 100 m grid, so '
        + 'it cannot see which side of an embankment a hamlet sits on — and it '
        + 'does not model bund breaches at all. HAND at 100 m is kept as the '
        + 'finer-grained companion. No landslide sheet exists here, so that '
        + 'constraint excludes nothing.',
    },
    live: true,
  },
];

export const CASE_BY_ID = new Map(CASES.map((c) => [c.id, c]));

export const DEFAULT_CASE: CaseId = 'WAYANAD';

/* ---------------------------------------------------------- resolution */

/**
 * Which case a habitation belongs to, by GEOGRAPHY rather than by id.
 *
 * Deep links are the reason this is not just a focusId lookup. `#/evac/<id>`
 * can be opened with any case selected, and the terrain stack is a fixed
 * bounding box: loading the Wayanad rasters for an Odisha habitation would
 * not fail, it would produce a complete, confident analysis of the wrong
 * ground. Every figure would compute. Every one of them would be about Kerala.
 *
 * So the check is containment, not naming.
 */
export function caseForPoint(lngLat: [number, number]): CaseDef | undefined {
  const [lon, lat] = lngLat;
  return CASES.find(
    (c) =>
      c.stack &&
      lon >= c.stack.bounds[0] &&
      lon <= c.stack.bounds[2] &&
      lat >= c.stack.bounds[1] &&
      lat <= c.stack.bounds[3],
  );
}

/** The case a habitation is nominally part of, stack or not. */
export function caseForHabitation(id: string, state: string): CaseDef | undefined {
  return (
    CASES.find((c) => c.focusId === id) ??
    CASES.find((c) => c.region.toLowerCase().includes(state.toLowerCase()))
  );
}
