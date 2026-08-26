/* ============================================================================
 * LONG-TERM RESETTLEMENT EVALUATION
 *
 * Zone EXTRACTION is shared with the short-term tier (zones.ts). What differs
 * is everything after it: the rule set, the capacity model, and three layers
 * that only apply to permanent displacement.
 *
 * ANCHORED TO PUBLISHED FRAMEWORKS, NOT INVENTED
 *   Cernea's Impoverishment Risks and Reconstruction model (1997) supplies the
 *   risk structure -- landlessness, joblessness, homelessness, marginalisation,
 *   food insecurity, morbidity, loss of common property, community
 *   disarticulation. Every weighted factor below names the risk it addresses.
 *   RFCTLARR 2013 Third Schedule supplies the statutory amenity requirements.
 *
 * NO COMPOSITE LIVABILITY SCORE
 *   The resettlement literature's central finding is that schemes fail on
 *   precisely the dimensions a GIS cannot see -- place attachment, kin
 *   networks, willingness, tenure. Summing what we can measure into one number
 *   would manufacture exactly the false confidence the evidence warns about.
 *   Output is therefore tiered: MEASURED, PROXIED, REQUIRES FIELD SURVEY.
 * ==========================================================================*/

import type { Amenities, HostBody, TerrainStack } from './terrain';
import { haversineKm } from './terrain';
import type { Zone } from './zones';

/* ------------------------------------------------------------ thresholds --- */

/**
 * Statutory and normative distances. Every one is citable; none is invented.
 */
export const THRESHOLD = {
  /** RFCTLARR Third Schedule item 17, verbatim: "within two kilometres". */
  subHealthCentreM: 2000,
  /** Third Schedule item 18. */
  phcM: 5000,
  /** RTE Act 2009: primary school within 1 km. */
  primarySchoolM: 1000,
  /** Third Schedule item 1, read with the Rural Access Index (SDG 9.1.1):
   *  population within 2 km of an all-season road. */
  allWeatherRoadM: 2000,
  /** Third Schedule item 11, public transport to nearby growth centres. */
  growthCentreM: 5000,
  /** Third Schedule item 12. */
  burialGroundM: 5000,
  /** Third Schedule item 21. */
  worshipM: 3000,
} as const;

export interface ComplianceItem {
  item: number;
  label: string;
  requirement: string;
  observedM: number | null;
  thresholdM: number;
  pass: boolean;
}

/** Third Schedule items that are CONSTRUCTION OBLIGATIONS, not siting tests.
 *  A site does not "have" a drain or an anganwadi -- the acquirer must build
 *  one. Listing them separately stops them being scored as if a site could
 *  pass or fail on them, and gives the officer the actual build list. */
export const CONSTRUCTION_OBLIGATIONS = [
  'Roads within the resettled village',
  'Drainage and sanitation',
  'Safe drinking water per Government norms',
  'Drinking water for livestock',
  'Grazing land per State norms',
  'Fair price shop',
  'Panchayat Ghar',
  'Village post office with savings facility',
  'Seed-cum-fertiliser storage',
  'Basic irrigation for allotted agricultural land',
  'Individual sanitation toilets',
  'Electric connections and public lighting',
  'Anganwadi providing child and mother nutrition',
  "Children's playground",
  'Community centre per one hundred families',
  'Assembly platform',
  'Land for traditional tribal institutions',
  'Security arrangements where required',
  'Veterinary service centre',
];

/* -------------------------------------------------------------- weights --- */

export interface LongTermWeights {
  continuity: number;
  health: number;
  road: number;
  livelihood: number;
  education: number;
  settlement: number;
  commons: number;
}

export const LONG_TERM_WEIGHTS: LongTermWeights = {
  continuity: 0.25,
  health: 0.15,
  road: 0.15,
  livelihood: 0.15,
  education: 0.1,
  settlement: 0.1,
  commons: 0.1,
};

/** Which Cernea risk each weighted factor speaks to, and how well. */
export const FACTOR_BASIS: Record<
  keyof LongTermWeights,
  { risk: string; tier: 'MEASURED' | 'PROXIED'; note: string }
> = {
  continuity: {
    risk: 'Community disarticulation',
    tier: 'MEASURED',
    note: 'Distance from origin and whether the same taluk is retained.',
  },
  health: {
    risk: 'Increased morbidity and mortality',
    tier: 'MEASURED',
    note: 'Nearest mapped health facility against the statutory 2 km.',
  },
  road: {
    risk: 'Marginalisation (access)',
    tier: 'MEASURED',
    note: 'Distance to the routable road network, per the Rural Access Index.',
  },
  livelihood: {
    risk: 'Joblessness',
    tier: 'PROXIED',
    note: 'Land-use class match to the origin. Land use is not employment; this cannot see who works where.',
  },
  education: {
    risk: 'Marginalisation (schooling)',
    tier: 'MEASURED',
    note: 'Nearest school against the RTE 1 km norm.',
  },
  settlement: {
    risk: 'Marginalisation (market access)',
    tier: 'MEASURED',
    note: 'Distance to the nearest town, proxying market and transport access.',
  },
  commons: {
    risk: 'Loss of access to common property',
    tier: 'PROXIED',
    note: 'Proximity to mapped common land. Presence is not entitlement; grazing and forest rights are not in any public layer.',
  },
};

/** Cernea risks no geospatial layer can address. Shown, never scored. */
export const UNADDRESSED_RISKS = [
  { risk: 'Landlessness', why: 'Land tenure is held in district revenue records, not public GIS.' },
  { risk: 'Food insecurity', why: 'Requires household consumption and entitlement data.' },
  { risk: 'Marginalisation (social)', why: 'Requires caste, community and social-standing survey.' },
];

export const FIELD_SURVEY_REQUIRED = [
  'Land ownership and encumbrance (revenue record extract)',
  'Kin networks and social capital',
  'Actual employment and commuting patterns',
  'Willingness to relocate',
  'Community composition, burial and worship requirements',
];

/* -------------------------------------------------------------- results --- */

export type HostBand = 'ABSORBED' | 'STRAIN' | 'TRANSFORMATIVE' | 'UNKNOWN';

export interface HostImpact {
  body: HostBody | null;
  distanceKm: number;
  incomingPersons: number;
  deltaPct: number;
  band: HostBand;
}

export interface LongTermCandidate {
  zone: Zone;
  rank: number;
  /** Binary. Splitting a habitation across sites is a failure, not a partial
   *  success -- centralised resettlement outperforms scattered on every
   *  measured resilience outcome. */
  capacityGate: { pass: boolean; households: number; required: number };
  score: number;
  contributions: Record<keyof LongTermWeights, number>;
  observed: {
    distOriginKm: number;
    sameTaluk: boolean | null;
    talukName: string | null;
    healthM: number | null;
    schoolM: number | null;
    roadM: number;
    townM: number;
    commonsM: number | null;
    burialM: number | null;
    worshipM: number | null;
  };
  compliance: ComplianceItem[];
  host: HostImpact;
  /** Bearing difference from the short-term destination, if one is chosen. */
  directionDeltaDeg: number | null;
}

export interface LongTermResult {
  candidates: LongTermCandidate[];
  /** Zones that cleared every exclusion but cannot hold the habitation. */
  failedCapacity: number;
  withheld: boolean;
  withheldReason: string | null;
}

/* -------------------------------------------------------------- helpers --- */

const nearestM = (
  pt: [number, number],
  list: Array<{ lat: number; lon: number }>,
): number | null => {
  let best: number | null = null;
  for (const f of list) {
    const d = haversineKm(pt, [f.lon, f.lat]) * 1000;
    if (best === null || d < best) best = d;
  }
  return best;
};

function pointInRing(pt: [number, number], ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function talukAt(
  pt: [number, number],
  taluks: GeoJSON.FeatureCollection | undefined,
): string | null {
  if (!taluks) return null;
  for (const f of taluks.features) {
    const g = f.geometry;
    if (g.type !== 'MultiPolygon') continue;
    for (const poly of g.coordinates) {
      if (poly[0] && pointInRing(pt, poly[0])) {
        return (f.properties?.name as string) ?? null;
      }
    }
  }
  return null;
}

function bearing(a: [number, number], b: [number, number]) {
  const φ1 = (a[1] * Math.PI) / 180;
  const φ2 = (b[1] * Math.PI) / 180;
  const Δλ = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const SPLIT_FACILITIES = (stack: TerrainStack) => {
  const health = stack.manifest.facilities.filter(
    (f) => f.amenity === 'hospital' || f.amenity === 'clinic',
  );
  const hospitals = stack.manifest.facilities.filter((f) => f.amenity === 'hospital');
  const schools = stack.manifest.facilities.filter((f) => f.amenity === 'school');
  return { health, hospitals, schools };
};

/* ---------------------------------------------------------------- main --- */

export function evaluateLongTerm(
  zones: Zone[],
  stack: TerrainStack,
  origin: [number, number],
  requiredHouseholds: number,
  requiredPersons: number,
  weights: LongTermWeights,
  shortTermDestination: [number, number] | null,
): LongTermResult {
  const { health, hospitals, schools } = SPLIT_FACILITIES(stack);
  const amen: Amenities | undefined = stack.amenities;
  const hosts: HostBody[] = stack.hosts ?? [];
  const originTaluk = talukAt(origin, stack.taluks);
  const shortBearing = shortTermDestination ? bearing(origin, shortTermDestination) : null;

  /* Land-use class at the origin, for the livelihood proxy. */
  const originLu = zones.length ? zones[0].factors.landuse : 0;

  let failedCapacity = 0;
  const out: LongTermCandidate[] = [];

  for (const z of zones) {
    /* Both sides in HECTARES. The plot norm is 7 cents = 0.028328 ha, so the
     * numerator must be hectares too -- an earlier version multiplied by
     * 10,000 first and produced capacities 10,000x too large, which silently
     * disabled the gate. */
    const residentialHa = z.areaHa * (1 - 0.35);
    const households = Math.floor(residentialHa / 0.028328);
    const pass = households >= requiredHouseholds;
    if (!pass) {
      failedCapacity++;
      continue;
    }

    const c = z.centroid;
    const healthM = nearestM(c, health);
    const phcM = nearestM(c, hospitals);
    const schoolM = nearestM(c, schools);
    const burialM = amen ? nearestM(c, amen.burial) : null;
    const worshipM = amen ? nearestM(c, amen.worship) : null;
    const commonsM = amen ? nearestM(c, amen.common) : null;
    const roadM = z.factors.distRoadM;
    const townM = z.factors.distTownM;
    const talukName = talukAt(c, stack.taluks);
    const sameTaluk = originTaluk && talukName ? originTaluk === talukName : null;

    /* --- weighted factors, each named to a Cernea risk --- */
    const fContinuity =
      (1 - Math.min(1, z.distOriginKm / 30)) * 0.7 + (sameTaluk ? 0.3 : 0);
    const fHealth = healthM === null ? 0 : 1 - Math.min(1, healthM / (THRESHOLD.subHealthCentreM * 2));
    const fRoad = 1 - Math.min(1, roadM / (THRESHOLD.allWeatherRoadM * 1.5));
    const fLivelihood = z.factors.landuse === originLu ? 1 : z.factors.landuse === 3 ? 0.7 : 0.4;
    const fEducation = schoolM === null ? 0 : 1 - Math.min(1, schoolM / (THRESHOLD.primarySchoolM * 3));
    const fSettlement = 1 - Math.min(1, townM / 15000);
    const fCommons = commonsM === null ? 0 : 1 - Math.min(1, commonsM / 5000);

    const contributions = {
      continuity: fContinuity * weights.continuity * 100,
      health: fHealth * weights.health * 100,
      road: fRoad * weights.road * 100,
      livelihood: fLivelihood * weights.livelihood * 100,
      education: fEducation * weights.education * 100,
      settlement: fSettlement * weights.settlement * 100,
      commons: fCommons * weights.commons * 100,
    };
    const score = Object.values(contributions).reduce((a, b) => a + b, 0);

    /* --- Third Schedule siting compliance --- */
    const compliance: ComplianceItem[] = [
      {
        item: 1,
        label: 'All-weather road link',
        requirement: 'Link to the nearest pucca road',
        observedM: roadM,
        thresholdM: THRESHOLD.allWeatherRoadM,
        pass: roadM <= THRESHOLD.allWeatherRoadM,
      },
      {
        item: 11,
        label: 'Public transport to growth centre',
        requirement: 'Transport service to nearby growth centres',
        observedM: townM,
        thresholdM: THRESHOLD.growthCentreM,
        pass: townM <= THRESHOLD.growthCentreM,
      },
      {
        item: 12,
        label: 'Burial or cremation ground',
        requirement: 'Per community practice',
        observedM: burialM,
        thresholdM: THRESHOLD.burialGroundM,
        pass: burialM !== null && burialM <= THRESHOLD.burialGroundM,
      },
      {
        item: 16,
        label: 'School under the RTE Act',
        requirement: 'Primary school within 1 km',
        observedM: schoolM,
        thresholdM: THRESHOLD.primarySchoolM,
        pass: schoolM !== null && schoolM <= THRESHOLD.primarySchoolM,
      },
      {
        item: 17,
        label: 'Sub-health centre',
        requirement: 'Within two kilometres (statutory)',
        observedM: healthM,
        thresholdM: THRESHOLD.subHealthCentreM,
        pass: healthM !== null && healthM <= THRESHOLD.subHealthCentreM,
      },
      {
        item: 18,
        label: 'Primary Health Centre',
        requirement: 'Accessible PHC',
        observedM: phcM,
        thresholdM: THRESHOLD.phcM,
        pass: phcM !== null && phcM <= THRESHOLD.phcM,
      },
      {
        item: 21,
        label: 'Place of worship',
        requirement: 'Per community practice',
        observedM: worshipM,
        thresholdM: THRESHOLD.worshipM,
        pass: worshipM !== null && worshipM <= THRESHOLD.worshipM,
      },
    ];

    /* --- host impact --- */
    let body: HostBody | null = null;
    let bestKm = Infinity;
    for (const hb of hosts) {
      const d = haversineKm(c, [hb.lon, hb.lat]);
      if (d < bestKm) {
        bestKm = d;
        body = hb;
      }
    }
    const deltaPct = body ? (requiredPersons / body.population) * 100 : 0;
    const band: HostBand = !body
      ? 'UNKNOWN'
      : deltaPct < 10
        ? 'ABSORBED'
        : deltaPct < 30
          ? 'STRAIN'
          : 'TRANSFORMATIVE';

    let directionDeltaDeg: number | null = null;
    if (shortBearing !== null) {
      const b = bearing(origin, c);
      const d = Math.abs(((b - shortBearing + 540) % 360) - 180);
      directionDeltaDeg = 180 - d;
    }

    out.push({
      zone: z,
      rank: 0,
      capacityGate: { pass, households, required: requiredHouseholds },
      score,
      contributions,
      observed: {
        distOriginKm: z.distOriginKm,
        sameTaluk,
        talukName,
        healthM,
        schoolM,
        roadM,
        townM,
        commonsM,
        burialM,
        worshipM,
      },
      compliance,
      host: {
        body,
        distanceKm: bestKm === Infinity ? 0 : bestKm,
        incomingPersons: requiredPersons,
        deltaPct,
        band,
      },
      directionDeltaDeg,
    });
  }

  out.sort((a, b) => b.score - a.score);
  out.forEach((c, i) => (c.rank = i + 1));

  return {
    candidates: out,
    failedCapacity,
    withheld: out.length === 0,
    withheldReason:
      out.length === 0
        ? failedCapacity > 0
          ? `${failedCapacity} zones cleared every exclusion but none can hold ${requiredHouseholds} households as a single site. Splitting the habitation is not an acceptable permanent outcome.`
          : 'No ground within the operation radius clears the permanent-tier exclusions.'
        : null,
  };
}
