/* ============================================================================
 * SCENARIO: WAYANAD, KERALA -- landslide
 *
 * Scenario clock is set to 2024-07-29T23:30+05:30, i.e. the hours BEFORE the
 * 30 July event, so the display shows rainfall thresholds actually being
 * crossed rather than narrating an outcome after the fact. That is the state
 * an officer would have been looking at.
 *
 * Every score below is computed by derive() from its factor rows. None is
 * typed in by hand. Placeholder normalised values stand in until the GSI /
 * KSDMA layers are overlaid; the PENDING OVERLAY chip says so on screen.
 * ==========================================================================*/

import {
  capacityFrom,
  currentRainDrivers,
  landslideFactors,
  livabilityFactors,
  siteFactors,
} from './factory';
import {
  SRC_CENSUS,
  SRC_GSI_NLSM,
  SRC_IMD_NOWCAST,
  SRC_IMD_THRESHOLD,
  SRC_KSDMA_LS,
  SRC_M2_STRUCTURES,
  SRC_M4_LIVABILITY,
  SRC_REVENUE,
  SRC_SDMA_ADVISORY,
  derive,
} from './sources';
import type {
  CandidateSite,
  Habitation,
  ImmediateTier,
  LongTermTier,
  NowcastSeries,
  ShortTermTier,
} from './schema';

import {
  ANNUAL_MAXIMA,
  RAINFALL_CELL,
  RAINFALL_PROVENANCE,
  RAIN_AT_CLOCK,
  RAIN_FRAMES,
  RETURN_LEVELS,
  RETURN_LEVEL_PROVENANCE,
  TRIGGER_RP_BY_BAND,
} from './rainfall';

/* Operating picture is set to 30 Jul 2024 02:00 IST -- inside the failure
 * window, with the 24 h accumulation still climbing. */
export const WAYANAD_CLOCK = RAIN_AT_CLOCK.t;

/* ------------------------------------------------------------- nowcast   */

const meppadiNowcast: NowcastSeries = {
  stationId: 'IMERG-C-2561-1014',
  stationName: `GPM IMERG cell ${RAINFALL_CELL.lat.toFixed(2)} N ${RAINFALL_CELL.lon.toFixed(2)} E`,
  lngLat: [RAINFALL_CELL.lon, RAINFALL_CELL.lat],
  distanceKm: 0,
  provenance: RAINFALL_PROVENANCE,
  /* Thresholds are this cell's own fitted return levels, not the national IMD
   * category boundary -- see rainfall.ts for why that substitution is
   * necessary rather than merely convenient. */
  thresholds: [
    {
      key: 'rl2',
      label: '1-in-2-year, 24 h',
      value: RETURN_LEVELS[2],
      window: '24h',
      basis: `Gumbel fit, ${ANNUAL_MAXIMA.years} annual maxima ${ANNUAL_MAXIMA.from}-${ANNUAL_MAXIMA.to}. Trigger level for VERY HIGH susceptibility.`,
    },
    {
      key: 'rl10',
      label: '1-in-10-year, 24 h',
      value: RETURN_LEVELS[10],
      window: '24h',
      basis: 'Same fit. Trigger level for MODERATE susceptibility.',
    },
    {
      key: 'rl25',
      label: '1-in-25-year, 24 h',
      value: RETURN_LEVELS[25],
      window: '24h',
      basis: 'Same fit. Reference level only.',
    },
  ],
  frames: RAIN_FRAMES.map((f) => ({
    t: f.t,
    rain3h: f.rain3h,
    rain24h: f.rain24h,
    rainCumulative: f.rainCumulative,
    alert:
      f.returnPeriodYears >= 10
        ? ('RED' as const)
        : f.returnPeriodYears >= 5
          ? ('ORANGE' as const)
          : f.returnPeriodYears >= 2
            ? ('YELLOW' as const)
            : ('GREEN' as const),
  })),
};

/* -------------------------------------------------- Chooralmala scoring  */

const chooralmalaSusceptibility = derive(
  landslideFactors([
    ['31.4 deg mean, 38.2 deg max in crown zone', 88, '0-10 deg = 0, >35 deg = 100 (GSI class break)'],
    ['Charnockite, weathered mantle 8-12 m', 85, 'Class score, GSI lithology table'],
    ['385 m over 1 km radius', 78, '<100 m = 0, >500 m = 100'],
    ['First-order channel at 40 m; Punnapuzha at 210 m', 76, 'Inverse distance, 500 m cutoff'],
    ['Tea and cardamom on cut terraces; natural forest cleared', 71, 'LULC class score'],
    ['3 events within 5 km since 2018', 92, 'Inventory density, 5 km kernel'],
    ['1.4 km per sq km, NNW-SSE trend', 65, '0-2.5 km/sq km linear'],
  ]),
  SRC_GSI_NLSM,
);

const SCALE_24H = `Ratio to this cell's 1-in-10-year 24 h level (${RETURN_LEVELS[10]} mm), capped at 100`;
const SCALE_3H = `Ratio to one eighth of the 1-in-10-year 24 h level (${(RETURN_LEVELS[10] / 8).toFixed(1)} mm), capped at 100`;

const chooralmalaCurrent = derive(
  currentRainDrivers([
    [`${RAIN_AT_CLOCK.rainCumulative} mm observed`, 90, SCALE_24H],
    [`${RAIN_AT_CLOCK.rain24h} mm observed — 1-in-${RAIN_AT_CLOCK.returnPeriodYears}-year for this cell`, 82, SCALE_24H],
    [`${chooralmalaSusceptibility.score} (VERY HIGH)`, 81, 'Carried from standing assessment'],
    [`${RAIN_AT_CLOCK.rain3h} mm observed`, 100, SCALE_3H],
  ]),
  RAINFALL_PROVENANCE,
);

/* ------------------------------------------------------ immediate tier   */

const chooralmalaImmediate: ImmediateTier = {
  flag: {
    status: 'FLAGGED',
    rationale:
      `Red zone declared 30 Jul 00:00 IST: 24 h accumulation ${RAIN_AT_CLOCK.rain24h} mm is a 1-in-${RAIN_AT_CLOCK.returnPeriodYears}-year event for this cell, above the 1-in-2-year level required at VERY HIGH susceptibility.`,
    since: '2024-07-30T00:00:00+05:30',
  },
  redZoneStatus: 'DECLARED - active, evacuation order in force for 4 wards',
  routingScenarioId: 'WYD-CHOORALMALA',
  nowcast: meppadiNowcast,
  triggers: [
    {
      key: 'rl24',
      label: '24 h accumulation vs trigger level',
      observed: `${RAIN_AT_CLOCK.rain24h} mm`,
      threshold: `${RETURN_LEVELS[2]} mm (1-in-${TRIGGER_RP_BY_BAND.VERY_HIGH}-year, VERY HIGH band)`,
      crossed: true,
      crossedAt: '2024-07-30T00:00:00+05:30',
      provenance: RETURN_LEVEL_PROVENANCE,
    },
    {
      key: 'rp',
      label: 'Return period, 24 h',
      observed: `1-in-${RAIN_AT_CLOCK.returnPeriodYears}-year for this cell`,
      threshold: `1-in-${TRIGGER_RP_BY_BAND.VERY_HIGH}-year, required at VERY HIGH susceptibility`,
      crossed: true,
      crossedAt: '2024-07-30T00:00:00+05:30',
      provenance: RETURN_LEVEL_PROVENANCE,
    },
    {
      key: 'imd',
      label: 'IMD "extremely heavy" category',
      observed: `${RAIN_AT_CLOCK.rain24h} mm (satellite estimate)`,
      threshold: '204.5 mm (gauge-calibrated, not applicable to this product)',
      crossed: false,
      provenance: RAINFALL_PROVENANCE,
    },
    {
      key: 'r3',
      label: 'Intensity, 3 h',
      observed: `${RAIN_AT_CLOCK.rain3h} mm`,
      threshold: 'No fitted 3 h return level in this build',
      crossed: false,
      provenance: RAINFALL_PROVENANCE,
    },
    {
      key: 'advisory',
      label: 'District advisory',
      observed: 'ORANGE raised to RED',
      threshold: 'RED triggers mandatory evacuation of VERY HIGH zones',
      crossed: true,
      crossedAt: '2024-07-30T00:30:00+05:30',
      provenance: { ...SRC_SDMA_ADVISORY, observedAt: '2024-07-30T00:30:00+05:30' },
    },
  ],
  camps: [
    {
      id: 'CAMP-WYD-01',
      name: 'GVHSS Meppadi',
      type: 'Government school, designated relief camp',
      lngLat: [76.1403, 11.5503],
      distanceKm: 10.5,
      capacity: 620,
      occupancy: 418,
      facilities: ['Kitchen', 'Medical post', 'Generator', 'Women/child block'],
      observedAt: '2024-07-29T23:10:00+05:30',
      provenance: { ...SRC_SDMA_ADVISORY, observedAt: '2024-07-29T23:10:00+05:30' },
    },
    {
      id: 'CAMP-WYD-02',
      name: "St Joseph's UP School, Meppadi",
      type: 'Aided school, designated relief camp',
      lngLat: [76.1352, 11.5448],
      distanceKm: 10.8,
      capacity: 340,
      occupancy: 96,
      facilities: ['Kitchen', 'Water tank'],
      observedAt: '2024-07-29T23:10:00+05:30',
      provenance: { ...SRC_SDMA_ADVISORY, observedAt: '2024-07-29T23:10:00+05:30' },
    },
    {
      id: 'CAMP-WYD-03',
      name: 'Community Hall, Kalpetta',
      type: 'Municipal hall, designated relief camp',
      lngLat: [76.0861, 11.6112],
      distanceKm: 24.6,
      capacity: 450,
      occupancy: 112,
      facilities: ['Kitchen', 'Medical post', 'Generator', 'Fuel point'],
      observedAt: '2024-07-29T22:55:00+05:30',
      provenance: { ...SRC_SDMA_ADVISORY, observedAt: '2024-07-29T22:55:00+05:30' },
    },
    {
      id: 'CAMP-WYD-04',
      name: 'GHSS Vythiri',
      type: 'Government school, designated relief camp',
      lngLat: [76.0412, 11.5541],
      distanceKm: 28.9,
      capacity: 380,
      occupancy: 54,
      facilities: ['Kitchen', 'Water tank', 'Generator'],
      observedAt: '2024-07-29T22:55:00+05:30',
      provenance: { ...SRC_SDMA_ADVISORY, observedAt: '2024-07-29T22:55:00+05:30' },
    },
  ],
  evacuation: {
    totalMinutes: 214,
    breakdown: [
      { label: 'Population to move', value: '1,880 persons' },
      { label: 'Assembly and manifest', value: '35 min', note: 'Ward-wise muster at 4 points' },
      { label: 'Lift capacity', value: '6 vehicles x 32 seats = 192 per trip' },
      { label: 'Trips required', value: '10', note: 'ceil(1,880 / 192)' },
      { label: 'Round trip, primary route', value: '52 min', note: '12.8 km each way at derated speed' },
      { label: 'Concurrent lift', value: '3 vehicles staged', note: '10 trips / 3 lanes = 4 waves' },
      { label: 'Transit total', value: '179 min', note: '4 waves x 52 min minus overlap' },
      { label: 'Estimated total', value: '214 min', note: '35 assembly + 179 transit' },
    ],
    assumptions: [
      'Assumes primary route remains passable for the full window.',
      'Excludes 61 persons flagged as requiring stretcher or assisted transfer; those are handled on a separate medical lift.',
      'Night operation: speeds derated 20 per cent against daytime survey values.',
    ],
    provenance: { ...SRC_SDMA_ADVISORY, observedAt: WAYANAD_CLOCK },
  },
};

/* ----------------------------------------------------- short-term tier   */

const chooralmalaShortTerm: ShortTermTier = {
  flag: {
    status: 'FLAGGED',
    rationale:
      'Standing susceptibility VERY HIGH and slope remains saturated; unsafe for the remainder of the south-west monsoon.',
    since: '2024-06-01T00:00:00+05:30',
  },
  susceptibility: derive(chooralmalaSusceptibility.factors, SRC_KSDMA_LS),
  exposure: {
    structures: {
      label: 'Structures in hazard footprint',
      value: '389',
      derivation: 'Footprints intersecting the VERY HIGH polygon, 1.84 sq km',
      provenance: SRC_M2_STRUCTURES,
    },
    population: {
      label: 'Population in footprint',
      value: '1,642',
      derivation: '389 structures x 4.22 mean household size (Census 2011, projected)',
      provenance: SRC_CENSUS,
    },
    households: {
      label: 'Households in footprint',
      value: '361',
      derivation: 'Enumerated households whose dwelling centroid falls inside the footprint',
      provenance: SRC_CENSUS,
    },
    footprintHa: {
      label: 'Hazard footprint',
      value: '184.0 ha',
      derivation: 'VERY HIGH susceptibility polygon clipped to the revenue village boundary',
      provenance: SRC_GSI_NLSM,
    },
  },
  window: {
    activates: '01 June',
    lifts: '15 October',
    basis:
      'South-west monsoon onset to withdrawal, Kerala. Window holds open while modelled soil saturation stays above 0.6 of field capacity.',
    currentlyActive: true,
    provenance: { ...SRC_IMD_THRESHOLD, assessedOn: '2024-05-28T00:00:00+05:30' },
  },
  sites: [
    {
      id: 'TRN-WYD-01',
      name: 'Meppadi Grama Panchayat transit sheds',
      type: 'Prefabricated transitional units',
      lngLat: [76.1361, 11.5462],
      distanceKm: 10.6,
      unitsAvailable: 84,
      readiness: 'Ready - 84 of 120 units unoccupied',
      note: 'Water and power connected; 36 units held for Punchirimattom.',
      provenance: { ...SRC_SDMA_ADVISORY, observedAt: '2024-07-29T20:00:00+05:30' },
    },
    {
      id: 'TRN-WYD-02',
      name: 'Kalpetta municipal transit colony',
      type: 'Prefabricated transitional units',
      lngLat: [76.0842, 11.6068],
      distanceKm: 24.1,
      unitsAvailable: 148,
      readiness: 'Ready',
      provenance: { ...SRC_SDMA_ADVISORY, observedAt: '2024-07-29T20:00:00+05:30' },
    },
    {
      id: 'TRN-WYD-03',
      name: 'Vaduvanchal rented-accommodation pool',
      type: 'Rent-supported private accommodation',
      lngLat: [76.1848, 11.5203],
      distanceKm: 15.7,
      unitsAvailable: 62,
      readiness: 'Available on 7-day notice',
      note: 'Rent ceiling sanctioned at Rs 6,000/month per household.',
      provenance: { ...SRC_REVENUE, observedAt: '2024-07-26T00:00:00+05:30' },
    },
  ],
};

/* ------------------------------------------------------ long-term tier   */

const wayanadCandidates: CandidateSite[] = [
  {
    id: 'SITE-WYD-A',
    name: 'Meenangadi (Kolagappara sector)',
    block: 'Sulthan Bathery',
    district: 'Wayanad',
    lngLat: [76.2168, 11.6334],
    distanceKm: 22.4,
    verdict: 'ACCEPTED',
    suitability: derive(
      siteFactors([
        ['Mean slope 5.8 deg; GSI class LOW', 88, '>15 deg disqualifies; 0-8 deg = 100'],
        ['22.4 km by road from origin', 74, '<15 km = 100, >40 km = 0'],
        ['804 households against 412 required', 82, 'Ratio to requirement, capped'],
        ['Plantation and market employment within 12 km', 76, 'Sector-weighted access index'],
        ['NH-766 at 2.1 km; 11 kV line at 0.4 km; piped supply present', 84, 'Composite access score'],
        ['Taluk office 8.6 km; PHC 3.2 km; police station 7.9 km', 79, 'Inverse distance composite'],
        ['Revenue puramboke, 46.8 ha, unencumbered', 68, 'Tenure and encumbrance class'],
      ]),
      SRC_REVENUE,
    ),
    livability: derive(
      livabilityFactors([
        ['Piped scheme, 92 lpcd', 84],
        ['PHC 3.2 km, taluk hospital 9.4 km', 77],
        ['LP school 1.1 km, HSS 4.6 km', 81],
        ['Daily market 3.4 km; bus every 20 min', 79],
        ['Feeder from Meenangadi substation, 4.1 outages/month', 72],
        ['Same panchayat cluster; 61 per cent of origin households have kin within 15 km', 68],
      ]),
      SRC_M4_LIVABILITY,
    ),
    capacity: {
      ...capacityFrom(
        46.8,
        [
          { label: 'Slope above 15 deg', ha: 6.2, basis: 'Cartosat DEM derivative' },
          { label: 'Existing built-up', ha: 3.4, basis: 'Structure footprints, M2' },
          { label: 'Water body + 30 m buffer', ha: 2.1, basis: 'Revenue survey + CRZ/wetland rule' },
        ],
        35,
        7,
      ),
      provenance: SRC_REVENUE,
    },
    land: {
      classification: 'Revenue puramboke, partly under cashew',
      ownership: 'Government of Kerala',
      acquisitionStatus: 'No acquisition required; transfer order pending revenue concurrence',
      encumbrances: [],
      provenance: SRC_REVENUE,
    },
  },
  {
    id: 'SITE-WYD-B',
    name: 'Kottathara (Kalpetta east)',
    block: 'Kalpetta',
    district: 'Wayanad',
    lngLat: [76.0502, 11.6331],
    distanceKm: 18.2,
    verdict: 'ACCEPTED',
    suitability: derive(
      siteFactors([
        ['Mean slope 11.4 deg; GSI class MODERATE', 71, '>15 deg disqualifies; 0-8 deg = 100'],
        ['18.2 km by road from origin', 80, '<15 km = 100, >40 km = 0'],
        ['448 households against 412 required', 64, 'Ratio to requirement, capped'],
        ['Plantation employment adjacent; market at Kalpetta 6 km', 81, 'Sector-weighted access index'],
        ['District hospital 2.4 km; SH at 0.8 km; piped supply present', 88, 'Composite access score'],
        ['Collectorate 6.1 km; taluk office 5.4 km', 86, 'Inverse distance composite'],
        ['Part private (12.1 ha) requiring acquisition', 55, 'Tenure and encumbrance class'],
      ]),
      SRC_REVENUE,
    ),
    livability: derive(
      livabilityFactors([
        ['Piped scheme, 104 lpcd', 88],
        ['District hospital 2.4 km', 91],
        ['LP school 0.9 km, HSS 2.2 km', 86],
        ['Kalpetta market 6.0 km; bus every 10 min', 85],
        ['Urban feeder, 2.3 outages/month', 83],
        ['Different panchayat cluster; 24 per cent kin retention', 41],
      ]),
      SRC_M4_LIVABILITY,
    ),
    capacity: {
      ...capacityFrom(
        28.4,
        [
          { label: 'Slope above 15 deg', ha: 4.8, basis: 'Cartosat DEM derivative' },
          { label: 'Existing built-up', ha: 2.9, basis: 'Structure footprints, M2' },
          { label: 'Water body + 30 m buffer', ha: 1.2, basis: 'Revenue survey' },
        ],
        35,
        7,
      ),
      provenance: SRC_REVENUE,
    },
    land: {
      classification: 'Mixed: 16.3 ha revenue, 12.1 ha private plantation',
      ownership: 'Government of Kerala + 9 private holdings',
      acquisitionStatus: 'RFCTLARR 2013 process required for private portion; SIA not commenced',
      encumbrances: ['9 private holdings', 'Two tenancy claims under enquiry'],
      provenance: SRC_REVENUE,
    },
  },
  {
    id: 'SITE-WYD-C',
    name: 'Nenmeni (Cheeral sector)',
    block: 'Sulthan Bathery',
    district: 'Wayanad',
    lngLat: [76.2834, 11.6002],
    distanceKm: 30.1,
    verdict: 'ACCEPTED',
    suitability: derive(
      siteFactors([
        ['Mean slope 6.9 deg; GSI class LOW', 84, '>15 deg disqualifies; 0-8 deg = 100'],
        ['30.1 km by road from origin', 58, '<15 km = 100, >40 km = 0'],
        ['1,080 households against 412 required', 88, 'Ratio to requirement, capped'],
        ['Agricultural labour only; no plantation sector within 20 km', 61, 'Sector-weighted access index'],
        ['MDR at 1.6 km; 11 kV extension 2.3 km required; no piped scheme', 66, 'Composite access score'],
        ['Taluk office 14.2 km; PHC 6.8 km', 64, 'Inverse distance composite'],
        ['Revenue land, 61.2 ha, unencumbered', 79, 'Tenure and encumbrance class'],
      ]),
      SRC_REVENUE,
    ),
    livability: derive(
      livabilityFactors([
        ['Borewell dependent; no piped scheme', 54],
        ['PHC 6.8 km, taluk hospital 15.1 km', 58],
        ['LP school 2.7 km, HSS 8.9 km', 63],
        ['Weekly market 7.2 km; bus every 45 min', 57],
        ['Rural feeder, 8.7 outages/month', 55],
        ['Different taluk; 11 per cent kin retention', 28],
      ]),
      SRC_M4_LIVABILITY,
    ),
    capacity: {
      ...capacityFrom(
        61.2,
        [
          { label: 'Slope above 15 deg', ha: 5.1, basis: 'Cartosat DEM derivative' },
          { label: 'Existing built-up', ha: 1.8, basis: 'Structure footprints, M2' },
          { label: 'Water body + 30 m buffer', ha: 2.4, basis: 'Revenue survey' },
          { label: 'Notified vested forest', ha: 4.9, basis: 'Forest department vesting record' },
        ],
        35,
        7,
      ),
      provenance: SRC_REVENUE,
    },
    land: {
      classification: 'Revenue land under scrub',
      ownership: 'Government of Kerala',
      acquisitionStatus: 'No acquisition required',
      encumbrances: ['4.9 ha vested forest to be excluded from the layout'],
      provenance: SRC_REVENUE,
    },
  },
  {
    id: 'SITE-WYD-D',
    name: 'Thariode (Vythiri north)',
    block: 'Vythiri',
    district: 'Wayanad',
    lngLat: [76.0001, 11.6003],
    distanceKm: 14.3,
    verdict: 'REJECTED',
    disqualifier: {
      factor: 'Terrain suitability',
      observed: 'Mean slope 24.6 deg; GSI susceptibility class HIGH',
      threshold: 'Mean slope must be below 15 deg and class must not exceed MODERATE',
      rule:
        'Hard disqualification. A resettlement site may not sit in a class equal to or worse than the hazard being escaped.',
    },
    suitability: derive(
      siteFactors([
        ['Mean slope 24.6 deg; GSI class HIGH', 12, '>15 deg disqualifies; 0-8 deg = 100'],
        ['14.3 km by road from origin', 86, '<15 km = 100, >40 km = 0'],
        ['183 households against 412 required', 31, 'Ratio to requirement, capped'],
        ['Plantation employment adjacent', 83, 'Sector-weighted access index'],
        ['SH at 1.2 km; piped supply present', 74, 'Composite access score'],
        ['Taluk office 9.8 km', 72, 'Inverse distance composite'],
        ['Revenue land, unencumbered', 81, 'Tenure and encumbrance class'],
      ]),
      SRC_REVENUE,
    ),
    livability: derive(
      livabilityFactors([
        ['Piped scheme, 78 lpcd', 74],
        ['PHC 4.1 km', 71],
        ['LP school 1.8 km', 73],
        ['Market 5.9 km', 68],
        ['Rural feeder, 6.2 outages/month', 62],
        ['Adjacent panchayat; 44 per cent kin retention', 57],
      ]),
      SRC_M4_LIVABILITY,
    ),
    capacity: {
      ...capacityFrom(
        22.6,
        [
          { label: 'Slope above 15 deg', ha: 12.8, basis: 'Cartosat DEM derivative' },
          { label: 'Stream + 30 m buffer', ha: 1.8, basis: 'Revenue survey' },
        ],
        35,
        7,
      ),
      provenance: SRC_REVENUE,
    },
    land: {
      classification: 'Revenue land under plantation',
      ownership: 'Government of Kerala',
      acquisitionStatus: 'Not pursued - site disqualified on terrain',
      encumbrances: [],
      provenance: SRC_REVENUE,
    },
  },
  {
    id: 'SITE-WYD-E',
    name: 'Noolpuzha (Muthanga fringe)',
    block: 'Sulthan Bathery',
    district: 'Wayanad',
    lngLat: [76.3502, 11.6001],
    distanceKm: 38.7,
    verdict: 'REJECTED',
    disqualifier: {
      factor: 'Land availability',
      observed:
        'Reserved forest inside the Wayanad Wildlife Sanctuary eco-sensitive zone; elephant corridor notified',
      threshold: 'Site must be free of forest diversion requirement',
      rule:
        'Hard disqualification. Diversion under the Forest (Conservation) Act 1980 plus ESZ clearance; corridor notification makes approval unobtainable on any resettlement timeline.',
    },
    suitability: derive(
      siteFactors([
        ['Mean slope 4.2 deg; GSI class VERY LOW', 94, '>15 deg disqualifies; 0-8 deg = 100'],
        ['38.7 km by road from origin', 22, '<15 km = 100, >40 km = 0'],
        ['Nominally 2,579 households before exclusions', 92, 'Ratio to requirement, capped'],
        ['No non-forest employment within 25 km', 34, 'Sector-weighted access index'],
        ['NH-766 at 3.4 km but night traffic ban in force', 48, 'Composite access score'],
        ['Taluk office 21.6 km', 41, 'Inverse distance composite'],
        ['Reserved forest; diversion required', 4, 'Tenure and encumbrance class'],
      ]),
      SRC_REVENUE,
    ),
    livability: derive(
      livabilityFactors([
        ['No scheme; borewell only', 38],
        ['PHC 12.4 km', 33],
        ['LP school 6.1 km', 41],
        ['Market 14.8 km; night traffic ban 21:00-06:00', 29],
        ['Rural feeder, 11.4 outages/month', 44],
        ['Different taluk; 6 per cent kin retention', 18],
      ]),
      SRC_M4_LIVABILITY,
    ),
    capacity: {
      ...capacityFrom(
        112.4,
        [
          { label: 'Reserved forest', ha: 96.2, basis: 'Forest department notification' },
          { label: 'Elephant corridor buffer', ha: 8.9, basis: 'Notified corridor alignment' },
        ],
        35,
        7,
      ),
      provenance: SRC_REVENUE,
    },
    land: {
      classification: 'Reserved forest',
      ownership: 'Forest Department, Government of Kerala',
      acquisitionStatus: 'Not pursued - site disqualified on land availability',
      encumbrances: [
        'Forest (Conservation) Act 1980 diversion',
        'Wayanad Wildlife Sanctuary eco-sensitive zone',
        'Notified elephant corridor',
      ],
      provenance: SRC_REVENUE,
    },
  },
];

const chooralmalaLongTerm: LongTermTier = {
  flag: {
    status: 'FLAGGED',
    rationale:
      'In-situ mitigation rejected on cost and residual risk; three viable destinations identified, highest-ranked carries 804 households against 412 required.',
    since: '2024-07-15T00:00:00+05:30',
  },
  mitigationRejection: {
    summary:
      'The failure mechanism is a deep-seated debris flow originating 1.9 km upslope, outside any structure that could be built within the habitation boundary. No in-situ measure addresses the initiation zone.',
    options: [
      {
        option: 'Slope stabilisation (soil nailing, shotcrete) on the settlement scarp',
        verdict: 'Insufficient',
        reason:
          'Treats the runout path, not the initiation zone 1.9 km upslope. Residual risk remains VERY HIGH.',
        indicativeCost: 'Rs 41 crore',
      },
      {
        option: 'Check dams and debris-retention barriers along the Punnapuzha channel',
        verdict: 'Insufficient',
        reason:
          'Design debris volume for the 2019 Puthumala event exceeded the achievable retention capacity by a factor of 6.',
        indicativeCost: 'Rs 28 crore',
      },
      {
        option: 'Early warning with in-situ shelter',
        verdict: 'Insufficient',
        reason:
          'Modelled runout reaches the settlement 4 to 7 minutes after initiation. No shelter-in-place option survives that lead time.',
        indicativeCost: 'Rs 3.6 crore',
      },
      {
        option: 'Managed retreat of the 4 most exposed wards only',
        verdict: 'Partial',
        reason:
          'Removes 61 per cent of exposed population but leaves 148 households inside the VERY HIGH polygon.',
        indicativeCost: 'Rs 62 crore',
      },
    ],
    provenance: { ...SRC_GSI_NLSM, assessedOn: '2024-07-15T00:00:00+05:30' },
  },
  candidates: wayanadCandidates,
};

/* ------------------------------------------------------------ habitation */

export const CHOORALMALA: Habitation = {
  id: 'WYD-CHOORALMALA',
  name: 'Chooralmala',
  block: 'Kalpetta',
  district: 'Wayanad',
  state: 'Kerala',
  lngLat: [76.1131, 11.4702],
  population: 1880,
  households: 412,
  lgdCode: '628114',
  hazards: ['LANDSLIDE', 'CLOUDBURST'],
  susceptibility: chooralmalaSusceptibility,
  current: {
    score: chooralmalaCurrent.score,
    alert: 'RED',
    drivers: chooralmalaCurrent.factors,
    observedAt: WAYANAD_CLOCK,
    provenance: { ...SRC_IMD_NOWCAST, observedAt: WAYANAD_CLOCK },
  },
  tiers: { IMMEDIATE: 'FLAGGED', SHORT_TERM: 'FLAGGED', LONG_TERM: 'FLAGGED' },
  detail: {
    immediate: chooralmalaImmediate,
    shortTerm: chooralmalaShortTerm,
    longTerm: chooralmalaLongTerm,
  },
};

/* ==========================================================================
 * PUNCHIRIMATTOM -- authored to demonstrate the WITHHELD long-term state.
 * Criteria for permanent resettlement are met, but no candidate survives the
 * disqualification rules, so the tier cannot be raised. Rendering this the
 * same as NOT_FLAGGED would read as "safe", which is the dangerous silence.
 * ==========================================================================*/

const punchSusceptibility = derive(
  landslideFactors([
    ['34.8 deg mean, 41.6 deg max', 93, '0-10 deg = 0, >35 deg = 100 (GSI class break)'],
    ['Charnockite, weathered mantle 11-16 m', 89, 'Class score, GSI lithology table'],
    ['441 m over 1 km radius', 86, '<100 m = 0, >500 m = 100'],
    ['First-order channel at 25 m', 84, 'Inverse distance, 500 m cutoff'],
    ['Cardamom under thinned canopy', 68, 'LULC class score'],
    ['4 events within 5 km since 2018', 96, 'Inventory density, 5 km kernel'],
    ['1.9 km per sq km', 74, '0-2.5 km/sq km linear'],
  ]),
  SRC_GSI_NLSM,
);

/* Same cell, therefore identical rainfall -- the panel says so explicitly. */
const punchCurrent = derive(
  currentRainDrivers([
    [`${RAIN_AT_CLOCK.rainCumulative} mm observed`, 90, SCALE_24H],
    [`${RAIN_AT_CLOCK.rain24h} mm observed — 1-in-${RAIN_AT_CLOCK.returnPeriodYears}-year for this cell`, 82, SCALE_24H],
    [`${punchSusceptibility.score} (VERY HIGH)`, 88, 'Carried from standing assessment'],
    [`${RAIN_AT_CLOCK.rain3h} mm observed`, 100, SCALE_3H],
  ]),
  RAINFALL_PROVENANCE,
);

const punchCandidates: CandidateSite[] = [
  {
    id: 'SITE-PCM-A',
    name: 'Muppainad (upper terraces)',
    block: 'Vythiri',
    district: 'Wayanad',
    lngLat: [76.1004, 11.5168],
    distanceKm: 8.4,
    verdict: 'REJECTED',
    disqualifier: {
      factor: 'Terrain suitability',
      observed: 'Mean slope 19.8 deg; GSI susceptibility class HIGH',
      threshold: 'Mean slope must be below 15 deg and class must not exceed MODERATE',
      rule:
        'Hard disqualification. A resettlement site may not sit in a class equal to or worse than the hazard being escaped.',
    },
    suitability: derive(
      siteFactors([
        ['Mean slope 19.8 deg; GSI class HIGH', 21, '>15 deg disqualifies; 0-8 deg = 100'],
        ['8.4 km by road from origin', 94, '<15 km = 100, >40 km = 0'],
        ['95 households against 208 required', 22, 'Ratio to requirement, capped'],
        ['Cardamom employment adjacent', 86, 'Sector-weighted access index'],
        ['ODR at 0.6 km; piped supply present', 71, 'Composite access score'],
        ['Taluk office 12.4 km', 66, 'Inverse distance composite'],
        ['Revenue land, unencumbered', 78, 'Tenure and encumbrance class'],
      ]),
      SRC_REVENUE,
    ),
    livability: derive(
      livabilityFactors([
        ['Piped scheme, 71 lpcd', 69],
        ['PHC 5.2 km', 64],
        ['LP school 2.1 km', 71],
        ['Market 8.4 km', 58],
        ['Rural feeder, 7.8 outages/month', 58],
        ['Same panchayat; 74 per cent kin retention', 78],
      ]),
      SRC_M4_LIVABILITY,
    ),
    capacity: {
      ...capacityFrom(
        14.2,
        [
          { label: 'Slope above 15 deg', ha: 8.9, basis: 'Cartosat DEM derivative' },
          { label: 'Stream + 30 m buffer', ha: 1.1, basis: 'Revenue survey' },
        ],
        35,
        7,
      ),
      provenance: SRC_REVENUE,
    },
    land: {
      classification: 'Revenue land under cardamom',
      ownership: 'Government of Kerala',
      acquisitionStatus: 'Not pursued - site disqualified on terrain',
      encumbrances: [],
      provenance: SRC_REVENUE,
    },
  },
  {
    id: 'SITE-PCM-B',
    name: 'Vellarimala (estate block 4)',
    block: 'Vythiri',
    district: 'Wayanad',
    lngLat: [76.1334, 11.4503],
    distanceKm: 5.1,
    verdict: 'REJECTED',
    disqualifier: {
      factor: 'Terrain suitability',
      observed: 'Falls inside the same VERY HIGH susceptibility polygon as the origin',
      threshold: 'Site must lie outside the origin hazard polygon',
      rule:
        'Hard disqualification. Relocating within the initiating catchment does not reduce exposure.',
    },
    suitability: derive(
      siteFactors([
        ['Mean slope 27.4 deg; GSI class VERY HIGH', 6, '>15 deg disqualifies; 0-8 deg = 100'],
        ['5.1 km by road from origin', 98, '<15 km = 100, >40 km = 0'],
        ['102 households against 208 required', 34, 'Ratio to requirement, capped'],
        ['Estate employment on site', 91, 'Sector-weighted access index'],
        ['Estate road only; 3.2 m carriageway', 42, 'Composite access score'],
        ['Taluk office 16.1 km', 58, 'Inverse distance composite'],
        ['Private estate; acquisition required', 38, 'Tenure and encumbrance class'],
      ]),
      SRC_REVENUE,
    ),
    livability: derive(
      livabilityFactors([
        ['Estate supply, intermittent', 48],
        ['PHC 7.8 km', 51],
        ['LP school 3.4 km', 58],
        ['Market 11.2 km', 44],
        ['Estate feeder, 9.1 outages/month', 51],
        ['Same panchayat; 81 per cent kin retention', 84],
      ]),
      SRC_M4_LIVABILITY,
    ),
    capacity: {
      ...capacityFrom(
        18.8,
        [
          { label: 'Slope above 15 deg', ha: 13.4, basis: 'Cartosat DEM derivative' },
          { label: 'Stream + 30 m buffer', ha: 0.9, basis: 'Revenue survey' },
        ],
        35,
        7,
      ),
      provenance: SRC_REVENUE,
    },
    land: {
      classification: 'Private plantation',
      ownership: 'Estate company, single holding',
      acquisitionStatus: 'Not pursued - site disqualified on terrain',
      encumbrances: ['Single private holding', 'Plantation labour housing in occupation'],
      provenance: SRC_REVENUE,
    },
  },
  {
    id: 'SITE-PCM-C',
    name: 'Pozhuthana (west bank)',
    block: 'Vythiri',
    district: 'Wayanad',
    lngLat: [76.0169, 11.5502],
    distanceKm: 16.8,
    verdict: 'REJECTED',
    disqualifier: {
      factor: 'Carrying capacity adequacy',
      observed: '70 households after exclusions, against 208 required',
      threshold: 'Site must accommodate at least the full displaced household count',
      rule:
        'Hard disqualification. Partial capacity would split the habitation across sites, which the social-cohesion criterion does not permit as a primary destination.',
    },
    suitability: derive(
      siteFactors([
        ['Mean slope 9.2 deg; GSI class MODERATE', 76, '>15 deg disqualifies; 0-8 deg = 100'],
        ['16.8 km by road from origin', 82, '<15 km = 100, >40 km = 0'],
        ['70 households against 208 required', 14, 'Ratio to requirement, capped'],
        ['Plantation employment within 8 km', 74, 'Sector-weighted access index'],
        ['SH at 1.9 km; piped supply present', 78, 'Composite access score'],
        ['Taluk office 4.2 km', 88, 'Inverse distance composite'],
        ['Revenue land, unencumbered', 76, 'Tenure and encumbrance class'],
      ]),
      SRC_REVENUE,
    ),
    livability: derive(
      livabilityFactors([
        ['Piped scheme, 88 lpcd', 82],
        ['PHC 2.1 km, taluk hospital 4.6 km', 81],
        ['LP school 1.4 km, HSS 3.8 km', 79],
        ['Market 4.1 km', 76],
        ['Rural feeder, 5.4 outages/month', 68],
        ['Adjacent panchayat; 38 per cent kin retention', 52],
      ]),
      SRC_M4_LIVABILITY,
    ),
    capacity: {
      ...capacityFrom(
        9.4,
        [
          { label: 'Slope above 15 deg', ha: 1.9, basis: 'Cartosat DEM derivative' },
          { label: 'Existing built-up', ha: 2.1, basis: 'Structure footprints, M2' },
          { label: 'River + 50 m buffer', ha: 2.3, basis: 'Revenue survey' },
        ],
        35,
        7,
      ),
      provenance: SRC_REVENUE,
    },
    land: {
      classification: 'Revenue land, riverine terrace',
      ownership: 'Government of Kerala',
      acquisitionStatus: 'Not pursued - site disqualified on capacity',
      encumbrances: [],
      provenance: SRC_REVENUE,
    },
  },
];

export const PUNCHIRIMATTOM: Habitation = {
  id: 'WYD-PUNCHIRIMATTOM',
  name: 'Punchirimattom',
  block: 'Kalpetta',
  district: 'Wayanad',
  state: 'Kerala',
  lngLat: [76.0902, 11.4551],
  population: 948,
  households: 208,
  lgdCode: '628117',
  hazards: ['LANDSLIDE', 'CLOUDBURST'],
  susceptibility: punchSusceptibility,
  current: {
    score: punchCurrent.score,
    alert: 'RED',
    drivers: punchCurrent.factors,
    observedAt: WAYANAD_CLOCK,
    provenance: { ...SRC_IMD_NOWCAST, observedAt: WAYANAD_CLOCK },
  },
  tiers: { IMMEDIATE: 'FLAGGED', SHORT_TERM: 'FLAGGED', LONG_TERM: 'WITHHELD' },
  detail: {
    immediate: {
      ...chooralmalaImmediate,
      flag: {
        status: 'FLAGGED',
        rationale:
          'Red zone declared 30 Jul 00:00 IST on the terrain-conditioned rainfall trigger.',
        since: '2024-07-30T00:00:00+05:30',
      },
      redZoneStatus: 'DECLARED - active, evacuation order in force for the whole habitation',
      routingScenarioId: 'WYD-CHOORALMALA',
      evacuation: {
        totalMinutes: 141,
        breakdown: [
          { label: 'Population to move', value: '948 persons' },
          { label: 'Assembly and manifest', value: '25 min', note: 'Two muster points' },
          { label: 'Lift capacity', value: '4 vehicles x 32 seats = 128 per trip' },
          { label: 'Trips required', value: '8', note: 'ceil(948 / 128)' },
          { label: 'Round trip, primary route', value: '58 min', note: '14.7 km each way at derated speed' },
          { label: 'Concurrent lift', value: '2 vehicles staged', note: '8 trips / 2 lanes = 4 waves' },
          { label: 'Transit total', value: '116 min', note: '4 waves x 58 min minus overlap' },
          { label: 'Estimated total', value: '141 min', note: '25 assembly + 116 transit' },
        ],
        assumptions: [
          'Assumes the Attamala estate road remains passable; the direct approach is already cut.',
          'Night operation: speeds derated 20 per cent against daytime survey values.',
        ],
        provenance: { ...SRC_SDMA_ADVISORY, observedAt: WAYANAD_CLOCK },
      },
    },
    shortTerm: {
      ...chooralmalaShortTerm,
      flag: {
        status: 'FLAGGED',
        rationale:
          'Standing susceptibility VERY HIGH; initiation zone directly above the habitation remains saturated.',
        since: '2024-06-01T00:00:00+05:30',
      },
      susceptibility: derive(punchSusceptibility.factors, SRC_KSDMA_LS),
      exposure: {
        structures: {
          label: 'Structures in hazard footprint',
          value: '208',
          derivation: 'Footprints intersecting the VERY HIGH polygon, 0.71 sq km',
          provenance: SRC_M2_STRUCTURES,
        },
        population: {
          label: 'Population in footprint',
          value: '948',
          derivation: '208 structures x 4.56 mean household size (Census 2011, projected)',
          provenance: SRC_CENSUS,
        },
        households: {
          label: 'Households in footprint',
          value: '208',
          derivation: 'Entire habitation falls inside the footprint',
          provenance: SRC_CENSUS,
        },
        footprintHa: {
          label: 'Hazard footprint',
          value: '71.0 ha',
          derivation: 'VERY HIGH susceptibility polygon clipped to the revenue village boundary',
          provenance: SRC_GSI_NLSM,
        },
      },
    },
    longTerm: {
      flag: {
        status: 'WITHHELD',
        rationale:
          'Permanent resettlement criteria are met, but no candidate destination survives disqualification. Tier cannot be raised until a viable site exists.',
        since: '2024-07-15T00:00:00+05:30',
      },
      mitigationRejection: {
        summary:
          'Initiation zone sits 0.8 km directly upslope inside the same failure catchment. No in-situ measure is available, and no destination has yet been identified that satisfies the terrain and capacity rules simultaneously.',
        options: [
          {
            option: 'Slope stabilisation above the habitation',
            verdict: 'Insufficient',
            reason: 'Initiation zone is on a 34.8 deg slope with 11-16 m of weathered mantle; no achievable anchorage.',
            indicativeCost: 'Rs 34 crore',
          },
          {
            option: 'Debris-retention barrier across the channel',
            verdict: 'Insufficient',
            reason: 'Channel gradient exceeds the design envelope for retention structures.',
            indicativeCost: 'Rs 19 crore',
          },
          {
            option: 'Early warning with in-situ shelter',
            verdict: 'Insufficient',
            reason: 'Modelled runout reaches the settlement in under 3 minutes.',
            indicativeCost: 'Rs 2.1 crore',
          },
        ],
        provenance: { ...SRC_GSI_NLSM, assessedOn: '2024-07-15T00:00:00+05:30' },
      },
      candidates: punchCandidates,
    },
  },
};
