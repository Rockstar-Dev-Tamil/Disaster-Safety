/* ============================================================================
 * SCENARIO: KENDRAPARA, ODISHA -- coastal erosion
 *
 * Same operating picture clock as the Wayanad scenario (29 Jul 2024, 23:30
 * IST): one moment, one national picture. At that moment there is no system
 * in the Bay of Bengal, so this habitation sits at HIGH standing
 * susceptibility and a YELLOW current state simultaneously. That divergence
 * is the reason the header carries two scores instead of one -- a single
 * "risk" number would have to lie in one direction or the other.
 *
 * The standing band is HIGH rather than VERY HIGH because the shoreline
 * retreat factor now runs on measured transects rather than an authored rate.
 * The measurement is roughly half the figure the NCSCM atlas carries, and it
 * moved the score by fourteen points. That is the system working: a number
 * with a derivation behind it displaced one without, and the band followed.
 *
 * DESTINATION CANDIDATES ARE DERIVED FROM GEOGRAPHY ONLY: inland of the
 * 1-in-100-year surge envelope, outside CRZ-I, outside the Bhitarkanika
 * sanctuary and its eco-sensitive zone, on unencumbered government land with
 * existing road and service access. No known relocation outcome informed this
 * list; the weight vector in factory.ts decides the order.
 * ==========================================================================*/

import { capacityFrom, coastalFactors, currentCoastalDrivers, livabilityFactors, siteFactors } from './factory';
import { SHORELINE, retreatNormalised, retreatSummary } from './shoreline-kendrapara';
import {
  KDP_RAINFALL_CELL,
  KDP_RAINFALL_PROVENANCE,
  KDP_RAIN_FRAMES,
} from './rainfall-kendrapara';
import {
  SRC_CENSUS,
  SRC_DELTARES_SHORELINE,
  SRC_INCOIS_SURGE,
  SRC_M2_STRUCTURES,
  SRC_M4_LIVABILITY,
  SRC_NCSCM_SHORELINE,
  SRC_REVENUE,
  SRC_SDMA_ADVISORY,
  derive,
} from './sources';
import type { CandidateSite, Habitation, NowcastSeries } from './schema';

export const KENDRAPARA_CLOCK = '2024-07-29T23:30:00+05:30';

/* ------------------------------------------------------------- scoring   */

/* Measured, not assumed. See src/data/shoreline-kendrapara.ts. */
const SHORE = SHORELINE['Kanhupur'];

/* Residual distance from the habitation boundary to the active shoreline,
 * authored, and carried on the shoredist factor row below. Kept here so the
 * time-to-boundary figures downstream are arithmetic rather than prose. */
const SHORE_DIST_M = 180;

const MEDIAN_RETREAT = Math.abs(SHORE.medianRate ?? 0);
const WORST_RETREAT = Math.abs(SHORE.worstRate ?? 0);

/* At the reach median and at its fastest transect. Quoting a single figure
 * here would hide that the two ends of this reach differ by seven years. */
const YEARS_TO_BOUNDARY = Math.round(SHORE_DIST_M / MEDIAN_RETREAT);
const YEARS_TO_BOUNDARY_WORST = Math.round(SHORE_DIST_M / WORST_RETREAT);

/* The NCSCM shoreline change atlas records 14.6 m/yr end-point retreat for
 * this reach over 1990-2018. The satellite-derived transects do not reproduce
 * it: 90 transects within 5 km give a median of 6.5 m/yr, the fastest single
 * transect in the reach is 8.5 m/yr, and the nearest transect is 6.5 m/yr with
 * a standard error of 0.17 and an R-squared of 0.98 -- a well-constrained
 * measurement roughly a factor of two below the atlas figure.
 *
 * Both are kept. The score now moves on the measurement, because it is the one
 * with an auditable derivation behind it; the atlas figure stays on the row so
 * the disagreement is visible to whoever has to sign the recommendation. It is
 * not resolved here, and it should not be resolved silently: the two differ in
 * method (end-point versus least-squares), in period, and possibly in the
 * stretch of coast each describes. */
const NCSCM_RETREAT_NOTE =
  'NCSCM shoreline change atlas records 14.6 m/yr (DSAS end-point, 1990-2018) '
  + 'for this reach. Not reproduced by the satellite-derived transects; '
  + 'both figures retained pending reconciliation.';

const kanhupurSusceptibility = derive(
  coastalFactors([
    [
      retreatSummary(SHORE),
      retreatNormalised(SHORE),
      '0 m/yr = 0, >15 m/yr erosion = 100',
      NCSCM_RETREAT_NOTE,
      SRC_DELTARES_SHORELINE,
    ],
    ['3.2 m modelled, 1-in-100-yr cyclone', 87, '0 m = 0, >4 m = 100'],
    ['1.4 m above MSL', 89, '>8 m = 0, <2 m = 100'],
    ['40 m residual, from 1,150 m in 1990', 90, '>500 m = 0, <50 m = 100'],
    ['180 m to active shoreline', 88, '>2,000 m = 0, <200 m = 100'],
    ['3.1 m spring range; saline water table at 0.9 m', 76, 'Composite ingress index'],
  ]),
  SRC_NCSCM_SHORELINE,
);

const kanhupurCurrent = derive(
  currentCoastalDrivers([
    ['None in Bay of Bengal within 72 h', 8, 'IMD cyclone warning stage, 0-4 mapped to 0-100'],
    /* Derived, not restated. This row previously hardcoded both the band label
     * and the class score; when the retreat factor moved onto measured data
     * the standing assessment changed band, and a hardcoded copy would have
     * quietly disagreed with the number it claims to carry. */
    [
      `${kanhupurSusceptibility.score} (${kanhupurSusceptibility.band.replace('_', ' ')})`,
      Math.round(kanhupurSusceptibility.score),
      'Carried from standing assessment',
    ],
    ['Neap tide; next spring tide 04 Aug', 34, 'Phase position within the spring-neap cycle'],
    ['Swell 1.6 m; no INCOIS high-wave alert', 26, 'Significant wave height against alert threshold'],
    ['Monsoon westerly, 28 km/h onshore component', 44, 'Onshore component against 45 km/h threshold'],
  ]),
  { ...SRC_INCOIS_SURGE, observedAt: KENDRAPARA_CLOCK },
);

/* --------------------------------------------------------------- feeds   */

/* Coastal erosion is chronic rather than nowcast-driven, so the THRESHOLDS
 * here are surge and wave rather than rainfall. Same shape, so the same
 * component renders it.
 *
 * The rainfall values are observed, from the IMERG cell containing Kanhupur.
 * An earlier version of this feed presented them as readings from a named
 * automatic weather station, "Gahirmatha AWS". They were not: they were
 * authored placeholders, and once real satellite figures replaced them the
 * station name would have attributed a satellite retrieval to a ground gauge.
 * The feed is named for the cell it actually reads, as Wayanad's is. */
const kanhupurRainFeed: NowcastSeries = {
  stationId: 'IMERG-C-2669-1106',
  stationName: `GPM IMERG cell ${KDP_RAINFALL_CELL.lat.toFixed(2)} N `
    + `${KDP_RAINFALL_CELL.lon.toFixed(2)} E`,
  lngLat: [KDP_RAINFALL_CELL.lon, KDP_RAINFALL_CELL.lat],
  distanceKm: 2.7,
  provenance: KDP_RAINFALL_PROVENANCE,
  thresholds: [
    {
      key: 'surge',
      label: 'Surge above HAT',
      value: 1.5,
      window: '3h',
      basis: 'OSDMA evacuation trigger for Gahirmatha reach',
    },
    {
      key: 'wave',
      label: 'Significant wave height',
      value: 3.0,
      window: '3h',
      basis: 'INCOIS high-wave alert threshold',
    },
  ],
  /* Alerts stay authored and are NOT derived from the rainfall beside them.
   * They are coastal alert states set by surge and tide; letting a rain figure
   * drive them would quietly convert this into a pluvial case. */
  frames: KDP_RAIN_FRAMES.map((f, i) => ({
    ...f,
    alert: (['GREEN', 'GREEN', 'YELLOW', 'YELLOW', 'YELLOW', 'YELLOW', 'YELLOW'] as const)[i]
      ?? 'YELLOW',
  })),
};

/* ---------------------------------------------------------- candidates   */

const kendraparaCandidates: CandidateSite[] = [
  {
    id: 'SITE-KDP-A',
    name: 'Rajnagar (Tikhiri sector)',
    block: 'Rajnagar',
    district: 'Kendrapara',
    lngLat: [86.7312, 20.6218],
    distanceKm: 24.6,
    verdict: 'ACCEPTED',
    suitability: derive(
      siteFactors([
        ['6.4 m above MSL; outside 1-in-100-yr surge envelope; accretion-stable', 82, 'Elevation + surge exposure composite'],
        ['24.6 km by road from origin', 71, '<15 km = 100, >40 km = 0'],
        ['684 households against 214 required', 86, 'Ratio to requirement, capped'],
        ['Fishing access lost; nearest landing 18 km. Inland agriculture and brackish aquaculture available', 58, 'Sector-weighted access index'],
        ['Block HQ; SH at 1.2 km; 33 kV substation 2.1 km; piped scheme present', 88, 'Composite access score'],
        ['Block office 1.8 km; tahasil 3.1 km; police station 2.4 km', 92, 'Inverse distance composite'],
        ['Government anabadi land, 38.4 ha, unencumbered', 74, 'Tenure and encumbrance class'],
      ]),
      SRC_REVENUE,
    ),
    livability: derive(
      livabilityFactors([
        ['Piped scheme, 86 lpcd; no saline intrusion at depth', 84],
        ['CHC 2.2 km; district hospital 26 km', 79],
        ['Primary 0.8 km; high school 2.4 km', 82],
        ['Daily market 1.9 km; bus every 30 min', 81],
        ['Block feeder, 5.8 outages/month', 71],
        ['Whole-habitation relocation feasible; 100 per cent cohesion retained', 76],
      ]),
      SRC_M4_LIVABILITY,
    ),
    capacity: {
      ...capacityFrom(
        38.4,
        [
          { label: 'Waterlogged / saline patch', ha: 4.2, basis: 'Soil survey + Bhuvan wetness index' },
          { label: 'Existing built-up', ha: 2.8, basis: 'Structure footprints, M2' },
          { label: 'Tank + 30 m buffer', ha: 1.6, basis: 'Revenue survey' },
        ],
        35,
        7,
      ),
      provenance: SRC_REVENUE,
    },
    land: {
      classification: 'Government anabadi (unassessed waste)',
      ownership: 'Government of Odisha',
      acquisitionStatus: 'No acquisition required; alienation order pending tahasildar report',
      encumbrances: [],
      provenance: SRC_REVENUE,
    },
  },
  {
    id: 'SITE-KDP-B',
    name: 'Rajkanika (Chandol sector)',
    block: 'Rajkanika',
    district: 'Kendrapara',
    lngLat: [86.6201, 20.6154],
    distanceKm: 34.2,
    verdict: 'ACCEPTED',
    suitability: derive(
      siteFactors([
        ['7.8 m above MSL; well outside surge envelope', 86, 'Elevation + surge exposure composite'],
        ['34.2 km by road from origin', 52, '<15 km = 100, >40 km = 0'],
        ['1,214 households against 214 required', 91, 'Ratio to requirement, capped'],
        ['Fishing access lost; nearest landing 31 km. Agriculture only', 44, 'Sector-weighted access index'],
        ['MDR at 2.6 km; 11 kV extension 1.4 km required; piped scheme present', 74, 'Composite access score'],
        ['Block office 6.4 km; tahasil 6.9 km', 68, 'Inverse distance composite'],
        ['Government anabadi land, 64.2 ha, unencumbered', 81, 'Tenure and encumbrance class'],
      ]),
      SRC_REVENUE,
    ),
    livability: derive(
      livabilityFactors([
        ['Piped scheme, 78 lpcd', 76],
        ['PHC 4.1 km; CHC 9.6 km', 66],
        ['Primary 1.6 km; high school 5.2 km', 69],
        ['Weekly market 4.8 km; bus every 60 min', 58],
        ['Rural feeder, 9.2 outages/month', 58],
        ['Whole-habitation relocation feasible; 100 per cent cohesion retained', 76],
      ]),
      SRC_M4_LIVABILITY,
    ),
    capacity: {
      ...capacityFrom(
        64.2,
        [
          { label: 'Saline / waterlogged patch', ha: 6.8, basis: 'Soil survey + Bhuvan wetness index' },
          { label: 'Existing built-up', ha: 2.1, basis: 'Structure footprints, M2' },
          { label: 'Tank + 30 m buffer', ha: 2.4, basis: 'Revenue survey' },
        ],
        35,
        7,
      ),
      provenance: SRC_REVENUE,
    },
    land: {
      classification: 'Government anabadi (unassessed waste)',
      ownership: 'Government of Odisha',
      acquisitionStatus: 'No acquisition required',
      encumbrances: ['Grazing rights recorded for two adjoining villages'],
      provenance: SRC_REVENUE,
    },
  },
  {
    id: 'SITE-KDP-C',
    name: 'Marshaghai (Kaithakhola sector)',
    block: 'Marshaghai',
    district: 'Kendrapara',
    lngLat: [86.6604, 20.4218],
    distanceKm: 46.1,
    verdict: 'ACCEPTED',
    suitability: derive(
      siteFactors([
        ['5.9 m above MSL; outside surge envelope', 79, 'Elevation + surge exposure composite'],
        ['46.1 km by road from origin', 31, '<15 km = 100, >40 km = 0'],
        ['702 households against 214 required', 78, 'Ratio to requirement, capped'],
        ['Creek access retained; Kaithakhola landing 9 km; partial fishing continuity', 66, 'Sector-weighted access index'],
        ['MDR at 1.1 km; piped scheme present; 11 kV at 0.7 km', 69, 'Composite access score'],
        ['Block office 4.2 km; tahasil 4.8 km', 61, 'Inverse distance composite'],
        ['Government land, 41.6 ha, one encroachment case pending', 69, 'Tenure and encumbrance class'],
      ]),
      SRC_REVENUE,
    ),
    livability: derive(
      livabilityFactors([
        ['Piped scheme, 81 lpcd', 78],
        ['CHC 4.6 km', 71],
        ['Primary 1.2 km; high school 3.9 km', 76],
        ['Daily market 3.1 km', 74],
        ['Block feeder, 6.9 outages/month', 66],
        ['Whole-habitation relocation feasible; fishing identity partly retained', 81],
      ]),
      SRC_M4_LIVABILITY,
    ),
    capacity: {
      ...capacityFrom(
        41.6,
        [
          { label: 'Waterlogged patch', ha: 5.9, basis: 'Soil survey + Bhuvan wetness index' },
          { label: 'Existing built-up', ha: 3.2, basis: 'Structure footprints, M2' },
          { label: 'Canal + 30 m buffer', ha: 1.9, basis: 'Revenue survey' },
        ],
        35,
        7,
      ),
      provenance: SRC_REVENUE,
    },
    land: {
      classification: 'Government land under scrub',
      ownership: 'Government of Odisha',
      acquisitionStatus: 'Encroachment case under section 6, OPLE Act, pending disposal',
      encumbrances: ['One encroachment case, 2.4 ha'],
      provenance: SRC_REVENUE,
    },
  },
  {
    id: 'SITE-KDP-D',
    name: 'Gupti (Bhitarkanika fringe)',
    block: 'Rajnagar',
    district: 'Kendrapara',
    lngLat: [86.8501, 20.6902],
    distanceKm: 11.4,
    verdict: 'REJECTED',
    disqualifier: {
      factor: 'Land availability',
      observed:
        'Inside the Bhitarkanika Wildlife Sanctuary eco-sensitive zone; mangrove forest under Forest Department control',
      threshold: 'Site must be free of forest diversion and protected-area clearance requirement',
      rule:
        'Hard disqualification. Wildlife Protection Act 1972 read with Forest (Conservation) Act 1980; ESZ notification bars residential township use outright.',
    },
    suitability: derive(
      siteFactors([
        ['4.1 m above MSL; marginally outside surge envelope', 64, 'Elevation + surge exposure composite'],
        ['11.4 km by road from origin', 92, '<15 km = 100, >40 km = 0'],
        ['Nominally 683 households before exclusions', 74, 'Ratio to requirement, capped'],
        ['Full fishing continuity; landing 2.1 km', 94, 'Sector-weighted access index'],
        ['Village road only; no piped scheme; ferry dependency', 38, 'Composite access score'],
        ['Block office 12.8 km', 46, 'Inverse distance composite'],
        ['Protected mangrove forest; diversion required', 3, 'Tenure and encumbrance class'],
      ]),
      SRC_REVENUE,
    ),
    livability: derive(
      livabilityFactors([
        ['No scheme; saline shallow aquifer', 31],
        ['PHC 11.2 km', 34],
        ['Primary 2.8 km; no high school within 12 km', 41],
        ['No daily market; ferry-dependent access', 28],
        ['Rural feeder, 14.1 outages/month', 38],
        ['Full cohesion and livelihood retention', 88],
      ]),
      SRC_M4_LIVABILITY,
    ),
    capacity: {
      ...capacityFrom(
        29.8,
        [
          { label: 'Mangrove forest (protected)', ha: 24.6, basis: 'Forest Department notification' },
          { label: 'Creek + tidal buffer', ha: 3.1, basis: 'CRZ demarcation' },
        ],
        35,
        7,
      ),
      provenance: SRC_REVENUE,
    },
    land: {
      classification: 'Protected mangrove forest',
      ownership: 'Forest Department, Government of Odisha',
      acquisitionStatus: 'Not pursued - site disqualified on land availability',
      encumbrances: [
        'Bhitarkanika Wildlife Sanctuary eco-sensitive zone',
        'Forest (Conservation) Act 1980 diversion',
        'CRZ-I mangrove buffer',
      ],
      provenance: SRC_REVENUE,
    },
  },
  {
    id: 'SITE-KDP-E',
    name: 'Jamboo (river mouth)',
    block: 'Mahakalapada',
    district: 'Kendrapara',
    lngLat: [86.9804, 20.3201],
    distanceKm: 19.8,
    verdict: 'REJECTED',
    disqualifier: {
      factor: 'Terrain suitability',
      observed: '1.8 m above MSL; inside the 1-in-100-yr surge inundation envelope (3.2 m); CRZ-I',
      threshold: 'Site must lie above the modelled 1-in-100-yr surge level and outside CRZ-I',
      rule:
        'Hard disqualification. A resettlement site may not sit inside the hazard envelope being escaped.',
    },
    suitability: derive(
      siteFactors([
        ['1.8 m above MSL; inside surge envelope; CRZ-I', 6, 'Elevation + surge exposure composite'],
        ['19.8 km by road from origin', 79, '<15 km = 100, >40 km = 0'],
        ['Nominally 514 households before exclusions', 68, 'Ratio to requirement, capped'],
        ['Full fishing continuity; active landing on site', 96, 'Sector-weighted access index'],
        ['Village road; jetty present; no piped scheme', 44, 'Composite access score'],
        ['Block office 16.2 km', 39, 'Inverse distance composite'],
        ['Government land but CRZ-I restricted', 11, 'Tenure and encumbrance class'],
      ]),
      SRC_REVENUE,
    ),
    livability: derive(
      livabilityFactors([
        ['No scheme; saline aquifer', 26],
        ['PHC 14.6 km', 29],
        ['Primary 3.1 km', 38],
        ['Fish landing market on site; no daily market', 51],
        ['Rural feeder, 12.8 outages/month', 41],
        ['Full cohesion and livelihood retention', 89],
      ]),
      SRC_M4_LIVABILITY,
    ),
    capacity: {
      ...capacityFrom(
        22.4,
        [
          { label: 'Inside 1-in-100-yr surge envelope', ha: 18.9, basis: 'INCOIS surge model' },
          { label: 'CRZ-I no-development zone', ha: 2.2, basis: 'CRZ demarcation' },
        ],
        35,
        7,
      ),
      provenance: SRC_REVENUE,
    },
    land: {
      classification: 'Government land, coastal sand and mudflat',
      ownership: 'Government of Odisha',
      acquisitionStatus: 'Not pursued - site disqualified on terrain',
      encumbrances: ['CRZ-I', 'Within surge inundation envelope'],
      provenance: SRC_REVENUE,
    },
  },
];

/* ------------------------------------------------------------ habitation */

export const KANHUPUR: Habitation = {
  id: 'KDP-KANHUPUR',
  name: 'Kanhupur',
  nameLocal: 'କାହ୍ନୁପୁର',
  block: 'Rajnagar',
  district: 'Kendrapara',
  state: 'Odisha',
  lngLat: [86.9381, 20.6284],
  population: 962,
  households: 214,
  lgdCode: '410682',
  hazards: ['COASTAL_EROSION', 'CYCLONE'],
  susceptibility: kanhupurSusceptibility,
  current: {
    score: kanhupurCurrent.score,
    alert: 'YELLOW',
    drivers: kanhupurCurrent.factors,
    observedAt: KENDRAPARA_CLOCK,
    provenance: { ...SRC_INCOIS_SURGE, observedAt: KENDRAPARA_CLOCK },
  },
  tiers: { IMMEDIATE: 'NOT_FLAGGED', SHORT_TERM: 'FLAGGED', LONG_TERM: 'FLAGGED' },
  detail: {
    immediate: {
      flag: {
        status: 'NOT_FLAGGED',
        rationale:
          'No cyclonic system in the Bay of Bengal within 72 h and no surge or breach trigger crossed. Assessed and clear as of 23:30 IST.',
      },
      redZoneStatus: 'NOT DECLARED - standing watch only, 2 weak embankment reaches monitored',
      routingScenarioId: 'KDP-KANHUPUR',
      nowcast: kanhupurRainFeed,
      triggers: [
        {
          key: 'system',
          label: 'Cyclone warning stage',
          observed: 'NIL - no system in the Bay of Bengal',
          threshold: 'Stage 3 (cyclone alert) or above',
          crossed: false,
          provenance: { ...SRC_INCOIS_SURGE, observedAt: KENDRAPARA_CLOCK },
        },
        {
          key: 'surge',
          label: 'Surge above highest astronomical tide',
          observed: '0.4 m',
          threshold: '1.5 m',
          crossed: false,
          provenance: { ...SRC_INCOIS_SURGE, observedAt: KENDRAPARA_CLOCK },
        },
        {
          key: 'tidewind',
          label: 'Spring tide with onshore wind',
          observed: 'Neap tide; onshore component 28 km/h',
          threshold: 'Spring tide coincident with onshore wind above 45 km/h',
          crossed: false,
          provenance: { ...SRC_INCOIS_SURGE, observedAt: KENDRAPARA_CLOCK },
        },
        {
          key: 'breach',
          label: 'Embankment breach',
          observed: 'No breach reported; 2 reaches under watch',
          threshold: 'Any confirmed breach in the Gahirmatha reach',
          crossed: false,
          provenance: { ...SRC_SDMA_ADVISORY, observedAt: '2024-07-29T18:00:00+05:30' },
        },
        {
          key: 'retreat',
          label: 'Episodic shoreline retreat',
          observed: '3.1 m since 01 Jun',
          threshold: '12 m within a single monsoon triggers immediate review',
          crossed: false,
          provenance: { ...SRC_NCSCM_SHORELINE, observedAt: '2024-07-28T00:00:00+05:30' },
        },
      ],
      camps: [
        {
          id: 'CAMP-KDP-01',
          name: 'MCS Rajnagar',
          type: 'Multipurpose cyclone shelter',
          lngLat: [86.7341, 20.6231],
          distanceKm: 24.6,
          capacity: 1200,
          occupancy: 0,
          facilities: ['Kitchen', 'Water tank', 'Generator', 'Raised plinth', 'Women/child block'],
          observedAt: '2024-07-29T18:00:00+05:30',
          provenance: { ...SRC_SDMA_ADVISORY, observedAt: '2024-07-29T18:00:00+05:30' },
        },
        {
          id: 'CAMP-KDP-02',
          name: 'MCS Talachua',
          type: 'Multipurpose cyclone shelter',
          lngLat: [86.9102, 20.6902],
          distanceKm: 9.1,
          capacity: 900,
          occupancy: 0,
          facilities: ['Kitchen', 'Water tank', 'Raised plinth'],
          observedAt: '2024-07-29T18:00:00+05:30',
          provenance: { ...SRC_SDMA_ADVISORY, observedAt: '2024-07-29T18:00:00+05:30' },
        },
        {
          id: 'CAMP-KDP-03',
          name: 'Pattamundai College',
          type: 'Institution, designated relief camp',
          lngLat: [86.5702, 20.5901],
          distanceKm: 41.8,
          capacity: 1500,
          occupancy: 0,
          facilities: ['Kitchen', 'Medical post', 'Generator', 'Fuel point'],
          observedAt: '2024-07-29T18:00:00+05:30',
          provenance: { ...SRC_SDMA_ADVISORY, observedAt: '2024-07-29T18:00:00+05:30' },
        },
      ],
      evacuation: {
        totalMinutes: 168,
        breakdown: [
          { label: 'Population to move', value: '962 persons' },
          { label: 'Assembly and manifest', value: '40 min', note: 'Single muster point; boat transfer for 3 hamlets' },
          { label: 'Lift capacity', value: '3 vehicles x 40 seats = 120 per trip' },
          { label: 'Trips required', value: '9', note: 'ceil(962 / 120)' },
          { label: 'Round trip, primary route', value: '64 min', note: '9.1 km each way including creek crossing' },
          { label: 'Concurrent lift', value: '2 vehicles staged', note: '9 trips / 2 lanes = 5 waves' },
          { label: 'Transit total', value: '128 min', note: '5 waves x 64 min minus overlap' },
          { label: 'Estimated total', value: '168 min', note: '40 assembly + 128 transit' },
        ],
        assumptions: [
          'Assumes the Batighar creek crossing is operable; it is not usable above 1.2 m surge, at which point the Rajnagar route adds 62 minutes.',
          'Excludes livestock movement, which historically extends the window by 90 minutes or more.',
        ],
        provenance: { ...SRC_SDMA_ADVISORY, observedAt: KENDRAPARA_CLOCK },
      },
    },
    shortTerm: {
      flag: {
        status: 'FLAGGED',
        rationale:
          'Residual mangrove buffer at 40 m against 1,150 m in 1990; habitation unsafe through the combined monsoon and post-monsoon cyclone season.',
        since: '2024-05-01T00:00:00+05:30',
      },
      susceptibility: derive(kanhupurSusceptibility.factors, SRC_NCSCM_SHORELINE),
      exposure: {
        structures: {
          label: 'Structures in hazard footprint',
          value: '214',
          derivation: 'Footprints inside the 1-in-100-yr surge envelope, 0.96 sq km',
          provenance: SRC_M2_STRUCTURES,
        },
        population: {
          label: 'Population in footprint',
          value: '962',
          derivation: '214 structures x 4.50 mean household size (Census 2011, projected)',
          provenance: SRC_CENSUS,
        },
        households: {
          label: 'Households in footprint',
          value: '214',
          derivation: 'Entire habitation falls inside the envelope',
          provenance: SRC_CENSUS,
        },
        footprintHa: {
          label: 'Hazard footprint',
          value: '96.0 ha',
          derivation: '1-in-100-yr surge inundation polygon clipped to the revenue village boundary',
          provenance: SRC_INCOIS_SURGE,
        },
      },
      window: {
        activates: '01 May',
        lifts: '15 December',
        basis:
          'Combined south-west monsoon surge season and post-monsoon Bay of Bengal cyclone season. Window does not close in the intervening period because shoreline retreat is continuous rather than seasonal.',
        currentlyActive: true,
        provenance: { ...SRC_INCOIS_SURGE, assessedOn: '2024-04-20T00:00:00+05:30' },
      },
      sites: [
        {
          id: 'TRN-KDP-01',
          name: 'MCS Talachua, transitional occupancy',
          type: 'Cyclone shelter under extended occupancy',
          lngLat: [86.9102, 20.6902],
          distanceKm: 9.1,
          unitsAvailable: 180,
          readiness: 'Ready - shelter converted to family bays',
          note: 'Not suitable beyond 90 days; no separate kitchen provision per family.',
          provenance: { ...SRC_SDMA_ADVISORY, observedAt: '2024-07-29T18:00:00+05:30' },
        },
        {
          id: 'TRN-KDP-02',
          name: 'Rajnagar transit sheds',
          type: 'Prefabricated transitional units',
          lngLat: [86.7338, 20.6206],
          distanceKm: 24.6,
          unitsAvailable: 96,
          readiness: 'Ready',
          provenance: { ...SRC_SDMA_ADVISORY, observedAt: '2024-07-29T18:00:00+05:30' },
        },
      ],
    },
    longTerm: {
      flag: {
        status: 'FLAGGED',
        rationale:
          `Measured shoreline retreat of ${MEDIAN_RETREAT.toFixed(1)} m/yr across `
          + `the reach (fastest transect ${WORST_RETREAT.toFixed(1)} m/yr) makes any `
          + 'in-situ protection a delaying measure; three viable destinations '
          + 'identified, highest-ranked carries 684 households against 214 required.',
        since: '2024-03-10T00:00:00+05:30',
      },
      mitigationRejection: {
        summary:
          `At the measured reach median of ${MEDIAN_RETREAT.toFixed(1)} m/yr the active `
          + `shoreline reaches the habitation boundary in about ${YEARS_TO_BOUNDARY} years, `
          + `and in about ${YEARS_TO_BOUNDARY_WORST} at the fastest transect in the reach. `
          + 'That is a longer horizon than the NCSCM atlas rate implies, and it does not '
          + 'change the finding: the residual mangrove buffer is 40 m, every protection '
          + 'option below fails on its own terms, and hard protection transfers erosion '
          + 'downdrift and has failed twice on this reach.',
        options: [
          {
            option: 'Geotextile tube revetment along the exposed reach',
            verdict: 'Insufficient',
            reason:
              'Two previous installations on this reach were outflanked within 3 monsoons. Transfers erosion downdrift onto adjoining villages.',
            indicativeCost: 'Rs 18 crore',
          },
          {
            option: 'Mangrove replantation of the residual buffer',
            verdict: 'Insufficient',
            reason:
              'Establishment requires 8 to 12 years of sheltered conditions; retreat rate removes the planting bed faster than it establishes.',
            indicativeCost: 'Rs 6.4 crore',
          },
          {
            option: 'Embankment raising and strengthening',
            verdict: 'Insufficient',
            reason:
              'Addresses surge overtopping but not shoreline retreat. The embankment toe is itself within the retreat path.',
            indicativeCost: 'Rs 24 crore',
          },
          {
            option: 'Rock revetment (hard armour)',
            verdict: 'Rejected',
            reason:
              'CRZ-I and Bhitarkanika eco-sensitive zone bar hard armour on this reach; downdrift impact on the Gahirmatha turtle nesting beach is disqualifying.',
            indicativeCost: 'Rs 74 crore',
          },
        ],
        provenance: { ...SRC_NCSCM_SHORELINE, assessedOn: '2024-03-10T00:00:00+05:30' },
      },
      candidates: kendraparaCandidates,
    },
  },
};
