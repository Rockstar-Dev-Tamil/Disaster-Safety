/* ============================================================================
 * WIRE SCHEMA
 *
 * These types describe the shape the real API will return. Components import
 * only from here and from the fixture modules that satisfy these types --
 * never construct a figure inline. Swapping fixtures for live endpoints must
 * not require touching a single component.
 *
 * INVARIANT: every displayed figure is a `Figure` or carries a `Provenance`.
 * A number without an attached breakdown or source is a defect, not a style
 * choice, because an officer has to defend it to a Collector and a court.
 * ==========================================================================*/

/* ---------------------------------------------------------------- hazards */

export type HazardType =
  | 'LANDSLIDE'
  | 'FLOOD'
  | 'CYCLONE'
  | 'COASTAL_EROSION'
  | 'CLOUDBURST';

export const HAZARD_LABEL: Record<HazardType, string> = {
  LANDSLIDE: 'Landslide',
  FLOOD: 'Flood',
  CYCLONE: 'Cyclone',
  COASTAL_EROSION: 'Coastal erosion',
  CLOUDBURST: 'Cloudburst',
};

/* --------------------------------------------------------------- severity */

/** Static susceptibility class. GSI NLSM convention, 5 classes. */
export type SusceptibilityBand =
  | 'VERY_LOW'
  | 'LOW'
  | 'MODERATE'
  | 'HIGH'
  | 'VERY_HIGH';

/**
 * IMD operational warning colour code, 4 classes.
 * Deliberately a SEPARATE scale from SusceptibilityBand. One is a standing
 * terrain assessment, the other is a time-bounded warning state. Merging them
 * into a single "risk colour" would make the map lie in both directions.
 */
export type ImdAlert = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';

/* ------------------------------------------------------------- provenance */

/**
 * PENDING_OVERLAY -- placeholder standing in for a published layer that has
 *   been identified but not yet ingested. Rendered with a visible chip so a
 *   screenshot can never be mistaken for an official assessment.
 * LIVE           -- sampled from an ingested layer/feed.
 * STUB_M2/M4     -- surfaced from a module not in this build's scope.
 */
export type ProvenanceStatus =
  | 'PENDING_OVERLAY'
  | 'LIVE'
  | 'STUB_M2'
  | 'STUB_M4';

export interface Provenance {
  status: ProvenanceStatus;
  /** Publication or product name, as it should be cited. */
  source: string;
  agency: string;
  /** How the publisher derived the value -- shown verbatim to the officer. */
  method?: string;
  /** Native scale or grid of the source layer. */
  resolution?: string;
  citation?: string;
  /** When the underlying assessment was made (slow-moving figures). */
  assessedOn?: string;
  /** When the value was observed/sampled (fast-moving figures). */
  observedAt?: string;
}

/* ------------------------------------------------------------- breakdowns */

/**
 * One row of a weighted-overlay breakdown.
 * `raw` is what exists on the ground; `normalised` is what entered the sum.
 * Both are shown, because raw alone will not reconcile to the score and
 * normalised alone hides the ground truth.
 */
export interface Factor {
  key: string;
  label: string;
  /** Formatted ground value, e.g. "34.2 deg" or "Charnockite / gneiss". */
  raw: string;
  /** 0-100 class score after applying `scale`. */
  normalised: number;
  /** 0-1. Weights within one assessment must sum to 1.0. */
  weight: number;
  /** How raw was mapped to normalised. Shown on the row. */
  scale?: string;
  note?: string;
}

export interface Assessment {
  /** 0-100. Equals sum(normalised * weight) over `factors`. */
  score: number;
  band: SusceptibilityBand;
  factors: Factor[];
  provenance: Provenance;
  /** Set when the model is not a simple weighted sum of the rows above. */
  aggregation?: string;
}

/** A figure that is not itself a weighted overlay but still needs defending. */
export interface Figure {
  label: string;
  value: string;
  /** Arithmetic or derivation, shown beneath the value. */
  derivation?: string;
  provenance: Provenance;
}

/* -------------------------------------------------------- nowcast / IMD  */

export interface NowcastFrame {
  /** ISO 8601 with offset. */
  t: string;
  /** mm accumulated in the 3h ending at t. */
  rain3h: number;
  /** mm accumulated in the 24h ending at t. */
  rain24h: number;
  /** mm accumulated since the event window opened. */
  rainCumulative: number;
  alert: ImdAlert;
}

export interface NowcastThreshold {
  key: string;
  label: string;
  /** mm */
  value: number;
  window: '3h' | '24h' | 'cumulative';
  basis: string;
}

export interface NowcastSeries {
  stationId: string;
  stationName: string;
  lngLat: [number, number];
  distanceKm: number;
  frames: NowcastFrame[];
  thresholds: NowcastThreshold[];
  provenance: Provenance;
}

/* ------------------------------------------------------------------ tiers */

export type TierKey = 'IMMEDIATE' | 'SHORT_TERM' | 'LONG_TERM';

/**
 * FLAGGED     -- tier is active for this habitation.
 * NOT_FLAGGED -- assessed, criteria not met.
 * WITHHELD    -- criteria met BUT the tier cannot be raised. Only long-term
 *                uses this: the tier requires a nameable viable destination,
 *                and there isn't one. Without this third state, "no viable
 *                site" renders identically to "safe", which is the most
 *                dangerous silence in the whole interface.
 */
export type TierStatus = 'FLAGGED' | 'NOT_FLAGGED' | 'WITHHELD';

export interface TierFlag {
  status: TierStatus;
  /** One line, shown on the tab and at the top of the tier body. */
  rationale: string;
  since?: string;
}

/* --------------------------------------------------- immediate tier body */

export interface Trigger {
  key: string;
  label: string;
  observed: string;
  threshold: string;
  crossed: boolean;
  crossedAt?: string;
  provenance: Provenance;
}

export interface ReliefCamp {
  id: string;
  name: string;
  type: string;
  lngLat: [number, number];
  distanceKm: number;
  capacity: number;
  occupancy: number;
  /** Facility notes an officer needs before directing people there. */
  facilities: string[];
  observedAt: string;
  provenance: Provenance;
}

export interface EvacuationEstimate {
  totalMinutes: number;
  /** Every input to the arithmetic, so the total can be recomputed by hand. */
  breakdown: Array<{ label: string; value: string; note?: string }>;
  assumptions: string[];
  provenance: Provenance;
}

export interface ImmediateTier {
  flag: TierFlag;
  redZoneStatus: string;
  triggers: Trigger[];
  nowcast: NowcastSeries;
  camps: ReliefCamp[];
  evacuation: EvacuationEstimate;
  /** Scenario id for the routing view. */
  routingScenarioId: string;
}

/* -------------------------------------------------- short-term tier body */

export interface ExposureFigure {
  structures: Figure;
  population: Figure;
  households: Figure;
  footprintHa: Figure;
}

export interface SeasonalWindow {
  activates: string;
  lifts: string;
  basis: string;
  currentlyActive: boolean;
  provenance: Provenance;
}

export interface TransitionalSite {
  id: string;
  name: string;
  type: string;
  lngLat: [number, number];
  distanceKm: number;
  unitsAvailable: number;
  readiness: string;
  note?: string;
  provenance: Provenance;
}

export interface ShortTermTier {
  flag: TierFlag;
  susceptibility: Assessment;
  exposure: ExposureFigure;
  window: SeasonalWindow;
  sites: TransitionalSite[];
}

/* --------------------------------------------------- long-term tier body */

/** Every step of the usable-area chain, so the household count reconciles. */
export interface CapacityCalc {
  grossHa: number;
  exclusions: Array<{ label: string; ha: number; basis: string }>;
  netDevelopableHa: number;
  /** Roads, drains, school, anganwadi, commons. Dividing without this
   *  overstates household count by roughly a third. */
  infraOverheadPct: number;
  residentialHa: number;
  /** Plot-size norm. Displayed as a parameter because R&R norms are
   *  state-specific, not a universal constant. */
  plotNormCents: number;
  plotNormHa: number;
  households: number;
  provenance: Provenance;
}

export interface LandStatus {
  classification: string;
  ownership: string;
  acquisitionStatus: string;
  encumbrances: string[];
  provenance: Provenance;
}

export interface CandidateSite {
  id: string;
  name: string;
  block: string;
  district: string;
  lngLat: [number, number];
  distanceKm: number;
  verdict: 'ACCEPTED' | 'REJECTED';
  /** Present iff verdict === 'REJECTED'. The single disqualifying factor. */
  disqualifier?: {
    factor: string;
    observed: string;
    threshold: string;
    rule: string;
  };
  /** Multi-factor site suitability. Ranked on this. */
  suitability: Assessment;
  /** Module 4 output. Stubbed in this build; chip says so. */
  livability: Assessment;
  capacity: CapacityCalc;
  land: LandStatus;
}

export interface LongTermTier {
  flag: TierFlag;
  /** Why in-situ mitigation is judged insufficient. Required before the
   *  system is permitted to propose permanent displacement. */
  mitigationRejection: {
    summary: string;
    options: Array<{
      option: string;
      verdict: string;
      reason: string;
      indicativeCost?: string;
    }>;
    provenance: Provenance;
  };
  candidates: CandidateSite[];
}

/* ------------------------------------------------------------ habitation */

export interface Habitation {
  id: string;
  name: string;
  /** Local-language name where it materially aids identification. */
  nameLocal?: string;
  block: string;
  district: string;
  state: string;
  lngLat: [number, number];
  population: number;
  households: number;
  /** Census/LGD code -- the identifier the officer cross-references. */
  lgdCode: string;
  hazards: HazardType[];

  /** Standing terrain assessment. Changes on reassessment, not on weather. */
  susceptibility: Assessment;

  /** Operational state. Changes with the feed; always carries observedAt. */
  current: {
    score: number;
    alert: ImdAlert;
    /** What is driving `score` above susceptibility right now. */
    drivers: Factor[];
    observedAt: string;
    provenance: Provenance;
  };

  tiers: Record<TierKey, TierStatus>;

  /** Populated only for the two fully-authored demo habitations. */
  detail?: {
    immediate: ImmediateTier;
    shortTerm: ShortTermTier;
    longTerm: LongTermTier;
  };
}

/* --------------------------------------------------------------- routing */

export type NodeKind = 'ORIGIN' | 'JUNCTION' | 'CAMP' | 'WAYPOINT';

export interface RouteNode {
  id: string;
  name: string;
  kind: NodeKind;
  lngLat: [number, number];
  /** Chainage-style elevation, shown for ghat sections. */
  elevationM?: number;
}

/** Risk class 1-4, matching --risk-1..4. 4 is impassable-if-triggered. */
export type SegmentRiskClass = 1 | 2 | 3 | 4;

export interface RouteEdge {
  id: string;
  from: string;
  to: string;
  name: string;
  /** Road classification -- NH / SH / MDR / ODR / village road. */
  classification: string;
  lengthKm: number;
  /** Free-flow design speed; the traversal model derates this by risk. */
  speedKph: number;
  /** Polyline traced along the real alignment, [lng,lat]. */
  geometry: Array<[number, number]>;
  riskClass: SegmentRiskClass;
  /** 0-100, with its own weighted breakdown. */
  risk: Assessment;
  /** Operator-set. Drives recomputation. */
  blocked?: boolean;
}

export interface RouteGraph {
  scenarioId: string;
  originHabitationId: string;
  nodes: RouteNode[];
  edges: RouteEdge[];
  provenance: Provenance;
}

/** Output of the client-side search over RouteGraph. Not fixture data. */
export interface ComputedRoute {
  id: string;
  rank: number;
  destinationNodeId: string;
  destinationName: string;
  nodeIds: string[];
  edgeIds: string[];
  distanceKm: number;
  minutes: number;
  /** A route is as unsafe as its worst segment -- this is the ranking key. */
  worstSegmentRisk: number;
  worstSegmentId: string;
  /** Length-weighted mean. Shown alongside, never used to rank, because
   *  averaging hides a single lethal culvert in 40 km of good road. */
  meanRisk: number;
  feasible: boolean;
}

/* ---------------------------------------------------------- explanations */

export type ExplainScope =
  | 'PAN_INDIA'
  | 'HABITATION'
  | 'TIER_IMMEDIATE'
  | 'TIER_SHORT_TERM'
  | 'TIER_LONG_TERM'
  | 'ROUTING'
  /** Evacuation workspace: the extraction currently on screen. */
  | 'EVAC_ZONES';

export interface ExplainAnswer {
  /** Short plain text. Narrates only figures already on screen. */
  text: string;
  /** Which displayed factors the answer drew on. */
  sources: string[];
}

export interface ExplainEntry {
  /** Lowercase keyword sets; a query matches if it contains all of any set. */
  match: string[][];
  answer: ExplainAnswer;
}

/* --------------------------------------------------------- hazard layers */

export interface HazardLayer {
  id: string;
  label: string;
  hazard: HazardType;
  /** How the real layer arrives: raster tiles, or vector polygons. */
  kind: 'raster' | 'geojson';
  /** Populated at ingest. Null here means nothing is drawn yet. */
  url: string | null;
  opacity: number;
  legend: Array<{ label: string; band: SusceptibilityBand }>;
  provenance: Provenance;
}
