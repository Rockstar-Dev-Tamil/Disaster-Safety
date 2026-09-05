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

export type CaseId = 'WAYANAD' | 'KENDRAPARA' | 'ASSAM' | 'WESTBENGAL';

export interface TerrainStackRef {
  /** Directory under public/ holding manifest.json and the raster set. */
  base: string;
  /** Tile template for the relief view's raster-dem source.
   *
   *  Null where no DEM was built. That is a real case, not an oversight: on the
   *  Odisha delta elevation runs -3 to 27 m across the whole area of interest
   *  and mean slope is 0.2 degrees, so a DEM costs hundreds of megabytes to
   *  render a view that is flat by construction and to feed a gradient limit
   *  that excludes nothing. The relief toggle is hidden where this is null. */
  demTiles: string | null;
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
  /** Extent the hazard pyramid actually covers, when it is NARROWER than the
   *  stack. Declaring the stack's bounds on the tile source makes MapLibre ask
   *  for tiles in the gap between the two, and every one of those is a 404 in
   *  the console on a page that is working correctly. Defaults to `bounds`. */
  hazardTilesBounds?: [number, number, number, number];
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
  /** Forecast cones of uncertainty for this case's storm, one per issue time.
   *  Absent where the hazard is not a moving system: a debris flow and a
   *  shoreline do not have a cone. */
  coneUrl?: string;
  /** The rain field for this case's event -- the same sequence the national
   *  map draws, so the evacuation workspace shows the officer the weather they
   *  are siting into rather than making them switch views to see it. */
  rainSequenceUrl?: string;
  /** That same field as NUMBERS, cropped to this case, for the site ranking.
   *  Separate file because the sequence PNGs are colourised into eight bands
   *  and reading them back would recover the band, not the value. */
  rainGridUrl?: string;
}

/* --------------------------------------------------------------- registry */

export const CASES: CaseDef[] = [
  {
    id: 'WAYANAD',
    rainSequenceUrl: '/layers/ecmwf-sequence.json',
    rainGridUrl: '/layers/rain-grid-WAYANAD.json',
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
    rainSequenceUrl: '/layers/era5-fani-sequence.json',
    rainGridUrl: '/layers/rain-grid-KENDRAPARA.json',
    label: 'Kendrapara',
    region: 'Kendrapara, Odisha',
    hazard: 'COASTAL_EROSION',
    clock: KENDRAPARA_CLOCK,
    event:
      'Cyclone Fani, landfall near Puri 03 May 2019 — on chronic shoreline retreat',
    coneUrl: '/layers/cone-fani-exclusion.geojson',
    focusId: 'KDP-KANHUPUR',
    stack: {
      base: '/terrain-kendrapara',
      demTiles: null,
      /* Sized for a cyclone: holds the full 100 km operation radius around
       * Kanhupur (86.9381, 20.6284), which is the top of the slider. A cyclone
       * moves people out of a region rather than out of a valley, and the
       * earlier box ran out of ground at about 50 km.
       *
       * 150 m cells here rather than 100. On this delta gradient discriminates
       * nothing — mean slope 0.2 degrees — so the constraints that bind are
       * inundation return period and distance from the storm, neither of which
       * is resolved anywhere near 100 m. */
      bounds: [85.95, 19.7, 87.95, 21.55],
      demAttribution: 'No elevation model — see demTiles',
      hazardAttribution: 'Hazard: WRI Aqueduct surge and riverine return periods',
      hazardTiles: '/floodrp-kendrapara/{z}/{x}/{y}.png',
      hazardTilesMaxZoom: 11,
      /* The Aqueduct pull covered this box; the stack around it is wider. */
      hazardTilesBounds: [86.55, 20.25, 87.35, 21.0],
      hazardNote:
        'Flood layer combines WRI Aqueduct coastal surge AND riverine flood on '
        + 'the smallest return period — a cyclone brings both, and taking only '
        + 'the coastal product called the inland half of this area dry. The '
        + 'permanent tier excludes ground inside the 1-in-100. Native ~900 m, '
        + 'so it cannot see which side of an embankment a hamlet sits on, and '
        + 'it does not model bund breaches. No landslide sheet and no elevation '
        + 'model exist here: this is a delta at 0.2° mean slope, where gradient '
        + 'discriminates nothing and inundation return period is what binds.',
    },
  },
  {
    id: 'ASSAM',
    rainSequenceUrl: '/layers/ecmwf-live-sequence.json',
    rainGridUrl: '/layers/rain-grid-ASSAM.json',
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
  {
    id: 'WESTBENGAL',
    rainSequenceUrl: '/layers/ecmwf-live-sequence.json',
    rainGridUrl: '/layers/rain-grid-WESTBENGAL.json',
    label: 'Sundarbans',
    region: 'South 24 Parganas, West Bengal',
    /* Coastal erosion rather than cyclone, deliberately. Amphan and Yaas are
     * what this coast is known for, but the hazard that actually forces
     * relocation here is chronic: Ghoramara has been losing land for fifty
     * years and its people have been leaving for Sagar Island throughout, with
     * or without a storm in the Bay. */
    hazard: 'COASTAL_EROSION',
    /* Live, like Assam: no fixed clock, because the subject is a process
     * rather than an event. Empty so nothing renders a stale timestamp. */
    clock: '',
    event: 'Sundarbans shoreline retreat — live, no fixed event timestamp',
    focusId: null,
    stack: {
      base: '/terrain-westbengal',
      /* NO DEM, and this is the clearest case for it in the project. Measured
       * over this box on Copernicus GLO-30: median elevation 2.2 m, mean slope
       * 0.26 deg, maximum slope 5.3 deg across the whole area, and the share
       * of ground steeper than the 5 deg camp limit is 0.00 per cent. A DEM
       * would cost hundreds of megabytes to feed a gradient rule that excludes
       * nothing and a relief view that is flat by construction.
       *
       * West Bengal the STATE is not flat -- Darjeeling is 67 per cent above
       * 5 deg and reaches 3,603 m -- but that is 500 km north of this coast. */
      demTiles: null,
      /* Sized for a cyclone, like Kendrapara: holds the 100 km top of the
       * radius slider. Stops at 89.05 E because past that is Bangladesh, and a
       * relocation console must not offer sites across an international
       * border. */
      bounds: [87.3, 21.1, 89.05, 22.8],
      demAttribution: 'No elevation model — this delta is flat by measurement',
      hazardAttribution: 'Hazard: WRI Aqueduct surge and riverine return periods',
      hazardTiles: '/floodrp-westbengal/{z}/{x}/{y}.png',
      hazardTilesMaxZoom: 11,
      hazardNote:
        'Flood layer combines WRI Aqueduct coastal surge AND riverine flood on '
        + 'the smallest return period, because the Hooghly mouth takes both and '
        + 'a cell either reaches is reached. 31.8% of this box floods at '
        + '1-in-10 or more often — four times the Kendrapara figure, and the '
        + 'reason so little of the Sundarbans is sitable at all. Native ~900 m, '
        + 'so it cannot see which side of an embankment a hamlet sits on, and '
        + 'it does not model bund breaches — which on this coast is the way '
        + 'flooding usually actually happens. No landslide sheet and no '
        + 'elevation model exist here: at 0.26 deg mean slope, gradient '
        + 'discriminates nothing and inundation return period is what binds.',
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
