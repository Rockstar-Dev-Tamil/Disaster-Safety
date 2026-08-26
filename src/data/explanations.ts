/* ============================================================================
 * EXPLANATION RESPONSES (stubbed)
 *
 * Written the way the real system must answer: narrate only factor values that
 * are already rendered on screen in the same scope, name the specific numbers,
 * and introduce no outside reasoning. If a question cannot be answered from
 * displayed factors, the correct response is to say so -- not to reach for
 * general knowledge. The `sources` line names which displayed factors were
 * used, so the officer can check the answer against the tables above it.
 *
 * Matching is keyword-based: a query matches an entry if it contains every
 * word of any one of that entry's match sets.
 * ==========================================================================*/

import type { ExplainEntry, ExplainScope } from './schema';

export const SCOPE_LABEL: Record<ExplainScope, string> = {
  PAN_INDIA: 'scope: national view, active filters',
  HABITATION: 'scope: this habitation, header figures',
  TIER_IMMEDIATE: 'scope: immediate tier, triggers and camps',
  TIER_SHORT_TERM: 'scope: short-term tier, susceptibility and exposure',
  TIER_LONG_TERM: 'scope: long-term tier, site ranking',
  ROUTING: 'scope: route choice',
  EVAC_ZONES: 'scope: this search area',
};

export const SCOPE_HINTS: Record<ExplainScope, string[]> = {
  PAN_INDIA: ['why are so many habitations red tonight', 'what does the tier count mean'],
  HABITATION: ['why is susceptibility high but current higher', 'what drives the current score'],
  TIER_IMMEDIATE: [
    'why is this habitation red today',
    'why do four habitations show identical rainfall',
  ],
  TIER_SHORT_TERM: [
    'why does the window not lift until october',
    'what does the published ksdma sheet say',
  ],
  TIER_LONG_TERM: ['why did site a rank above site b', 'why was thariode rejected'],
  ROUTING: [],
  EVAC_ZONES: [
    'how much ground passed the filter',
    'what excluded the most land',
    'why is the top zone ranked first',
  ],
};

const ENTRIES: Record<ExplainScope, ExplainEntry[]> = {
  /* ---------------------------------------------------- evac workspace --- */
  EVAC_ZONES: [
    {
      match: [['exclud', 'most'], ['why', 'so', 'little'], ['what', 'removed']],
      answer: {
        text:
          'Exclusions are applied as hard constraints, and each cell records the '
          + 'FIRST rule that removed it, so the table is a partition rather than a '
          + 'set of overlapping counts. Gradient dominates: the camp limit is 5 '
          + 'degrees, which in this terrain removes over half the search radius on '
          + 'its own. Read the exclusion table top to bottom for the rest -- the '
          + 'rule that removed the most land is listed first.',
        sources: [
          'Step 3 exclusion table, per-rule cell counts',
          'Constraint rules: maximum ground gradient',
        ],
      },
    },
    {
      match: [['rank'], ['ranked'], ['first'], ['above']],
      answer: {
        text:
          'Ranking is a weighted sum over six factors, shown under Step 4. Area '
          + 'carries the heaviest weight because ranking on a mean of per-cell '
          + 'factors is size-blind: without it a small well-placed fragment '
          + 'outranks a large one on identical average slope and distance. Area '
          + 'saturates at three times what this habitation needs, so a very large '
          + 'zone cannot win on size alone. Open a candidate to see its own '
          + 'factor table.',
        sources: [
          'Step 4 suitability weights',
          'Candidate list: area, distance from origin, score',
        ],
      },
    },
    {
      match: [['ellipse'], ['circle'], ['shape'], ['boundary']],
      answer: {
        text:
          'The ellipse is the second moment of the eligible cells in a cluster, '
          + 'not a parcel boundary. The hazard sheets are 1:50,000 and the grid is '
          + '100 m, so nothing here supports drawing an exact edge -- it says '
          + 'eligible ground clusters here, roughly this size and orientation, go '
          + 'and look. It is also bounded, so a scattered cluster cannot draw an '
          + 'outline far larger than the ground that actually passed.',
        sources: ['Candidate zone geometry', 'Grid resolution, 100 m'],
      },
    },
  ],

  /* ------------------------------------------------------- pan-India --- */
  PAN_INDIA: [
    {
      match: [['red'], ['many'], ['tonight'], ['alert']],
      answer: {
        text:
          'The operating picture is fixed at 30 Jul 2024, 02:00 IST. Habitations '
          + 'shown RED are those whose current score is at or above 78, and at '
          + 'this timestamp that is driven by the observed rainfall across the '
          + 'Western Ghats: the IMERG cell over Chooralmala is reading 116.5 mm '
          + 'cumulative and 106.2 mm in 24 h, which is a 3.8-year return level '
          + 'against that cell’s own fitted record. Note the comparison is '
          + 'IMERG against IMERG: the IMD gauge threshold of 204.5 mm cannot be '
          + 'applied to a satellite estimate that under-reads orographic '
          + 'extremes here, and doing so would report no exceedance for this '
          + 'event. Coastal habitations are not red at this timestamp because '
          + 'there is no system in the Bay of Bengal.',
        sources: [
          'Status strip: operating picture timestamp',
          'Current score band thresholds (RED at 78)',
          'IMERG cumulative and 24 h accumulation at the operating clock',
          'Fitted return levels for this IMERG cell (2 y = 87.3 mm)',
        ],
      },
    },
    {
      match: [['tier'], ['count'], ['membership'], ['flag']],
      answer: {
        text:
          'The three tier counts in the status strip are independent flags, not a partition. A habitation can appear in all three, and the counts will not sum to the total habitation count. Immediate counts habitations whose current score is at or above 70. Short-term counts standing susceptibility at or above 60. Long-term counts only those where a viable destination site can be named; habitations that meet the criteria but have no viable site are counted separately as WITHHELD.',
        sources: [
          'Status strip: tier counts',
          'Tier flag rules (current >= 70, susceptibility >= 60)',
          'Long-term WITHHELD definition',
        ],
      },
    },
    {
      match: [['overlay'], ['layer'], ['shading'], ['district']],
      answer: {
        text:
          'The district shading currently on is the aggregate overlay: it takes the highest habitation susceptibility score inside each district polygon and shades the polygon to that band. It adds no information beyond the points already plotted; it exists so the national view reads at low zoom. The published GSI, NRSC and IMD layers are declared in the layer list but show NOT INGESTED because no URL is wired yet, and the map deliberately draws nothing for them rather than an empty layer that would read as "no hazard here".',
        sources: [
          'Layer panel: district susceptibility (aggregate)',
          'Layer provenance: derived, max over habitations',
          'Layer panel: NOT INGESTED status on published layers',
        ],
      },
    },
    {
      match: [['filter'], ['threshold']],
      answer: {
        text:
          'The risk threshold filter applies to whichever score is selected in the score selector directly above it, current or standing susceptibility. They are different scales and filtering on the wrong one is a common error: at this timestamp filtering on susceptibility above 75 returns a stable set of terrain assessments, while filtering on current above 75 returns only what the rainfall feed is driving tonight.',
        sources: [
          'Side rail: score selector',
          'Side rail: risk threshold slider',
          'Habitation list: score column',
        ],
      },
    },
  ],

  /* ------------------------------------------------------ habitation --- */
  HABITATION: [
    {
      match: [['two', 'score'], ['susceptibility', 'current'], ['difference'], ['both']],
      answer: {
        text:
          'They are different models over different inputs and neither can substitute for the other. Standing susceptibility, 81.1, is a terrain assessment: slope 31.4 deg at weight 0.25, charnockite with an 8-12 m weathered mantle at 0.20, and so on. It changes only on reassessment. The current score, 87.3, takes that 81.1 as one input at weight 0.20 and adds observed rainfall: 116.5 mm over 48 h at 0.35, 106.2 mm in 24 h at 0.30, 24.1 mm in 3 h at 0.15. Collapsing them into one number would mean the terrain assessment moved when it rained, which is not defensible in a hearing.',
        sources: [
          'Header: standing susceptibility 81.1',
          'Header: current 87.3',
          'Susceptibility factor table, weights 0.25 / 0.20',
          'Current driver table, weights 0.35 / 0.30 / 0.20 / 0.15',
        ],
      },
    },
    {
      match: [['drive', 'current'], ['current', 'score'], ['87']],
      answer: {
        text:
          'Four drivers, all observed or carried across. Antecedent 48 h rainfall contributes 31.5 of the 87.3 (90 normalised at weight 0.35), 24 h rainfall contributes 24.6 (82 at 0.30), standing susceptibility contributes 16.2 (81 at 0.20) and 3 h intensity contributes 15.0 (100 at 0.15). The largest single contribution is antecedent rainfall, not the terrain. Rainfall is normalised against this cell own 1-in-10-year 24 h level of 129.9 mm, not against a national category boundary.',
        sources: [
          'Current driver table: all four rows',
          'Contribution column',
          'Header: current 87.3',
        ],
      },
    },
    {
      match: [['tier'], ['three'], ['all']],
      answer: {
        text:
          'All three tiers are flagged here simultaneously, and that is not a contradiction. Immediate is flagged because the rainfall triggers crossed at 17:30 and the red zone was declared at 17:40. Short-term is flagged because standing susceptibility is 81.1 and the monsoon window runs to 15 October. Long-term is flagged because in-situ mitigation was assessed as insufficient and three viable destination sites exist. They answer different questions: move tonight, do not return this season, do not return at all.',
        sources: [
          'Tier strip: three flag states',
          'Immediate: declaration time 17:40',
          'Short-term: susceptibility 81.1, window to 15 Oct',
          'Long-term: 3 accepted candidates',
        ],
      },
    },
  ],

  /* ------------------------------------------------------- immediate --- */
  TIER_IMMEDIATE: [
    {
      match: [['why', 'red'], ['red', 'today'], ['red', 'zone'], ['trigger']],
      answer: {
        text:
          'The 24 h accumulation is 106.2 mm, a 1-in-3.8-year event for this cell. At VERY HIGH susceptibility the trigger level is the 1-in-2-year value, 87.3 mm, and that was crossed at 00:00 IST on 30 July. Note the third trigger row: against the IMD extremely-heavy category of 204.5 mm this rainfall does NOT qualify. That boundary is gauge-calibrated and this is a satellite estimate which under-reads orographic rainfall here by roughly a factor of three, so applying it would report no exceedance for this event. What fires is terrain-conditioned: this much rain on this slope, not this much rain anywhere.',
        sources: [
          'Trigger table: 24 h 106.2 mm against 1-in-2-year level 87.3 mm',
          'Trigger table: return period 1-in-3.8-year',
          'Trigger table: IMD category row, not crossed',
          'Return levels fitted to this cell, 26 annual maxima 1998-2023',
          'Header: standing susceptibility 81.1 VERY HIGH',
        ],
      },
    },
    {
      match: [['evacuation'], ['214'], ['time'], ['minutes'], ['long']],
      answer: {
        text:
          '214 minutes is 35 minutes of assembly plus 179 minutes of transit. Transit assumes 1,880 people against a lift capacity of 6 vehicles at 32 seats, which is 192 per trip and so 10 trips. With 3 vehicles staged concurrently that is 4 waves at a 52 minute round trip. Two things to note before relying on it: it assumes the primary route stays passable for the full window, and it excludes 61 people flagged for stretcher or assisted transfer who are on a separate medical lift.',
        sources: [
          'Evacuation breakdown: all eight rows',
          'Assumptions list: route passability, 61 assisted transfers',
          'Header: population 1,880',
        ],
      },
    },
    {
      match: [['camp'], ['capacity'], ['occupancy'], ['where']],
      answer: {
        text:
          'Four camps are listed with 1,790 total capacity against 680 currently occupied, so 1,110 places are free against 1,880 people to move. The nearest, GVHSS Meppadi at 10.5 km, is already at 418 of 620. On current occupancy the four camps together cannot absorb this habitation alone, and Kalpetta at 24.6 km with 338 free is the largest single block of spare capacity.',
        sources: [
          'Camp table: capacity and occupancy columns, all four rows',
          'Camp table: distance column',
          'Header: population 1,880',
        ],
      },
    },
  ],

  /* ------------------------------------------------------ short-term --- */
  TIER_SHORT_TERM: [
    {
      match: [['same', 'cell'], ['identical'], ['11', 'km'], ['resolution'], ['four']],
      answer: {
        text:
          'Because they share a single measurement. The rainfall source is one 0.1 degree GPM IMERG cell, about 11 km across, centred 11.45 N 76.15 E. Chooralmala, Mundakkai, Attamala and Punchirimattom all fall inside it, so all four read 106.2 mm and always will -- the product cannot resolve differences between them. What does separate them here is standing susceptibility, mapped at 1:50,000: 81.1 at Chooralmala against 86.2 at Punchirimattom.',
        sources: [
          'Feed panel: cell centre and 11 km footprint',
          'Current driver table: 24 h rainfall, identical across the four',
          'Header: standing susceptibility, which differs',
        ],
      },
    },
    {
      match: [['window'], ['october'], ['lift'], ['season']],
      answer: {
        text:
          'The window runs 01 June to 15 October, set to the south-west monsoon onset and withdrawal for Kerala. It is a seasonal envelope rather than a live measurement: inside it the operational decision is driven by observed rainfall against the terrain-conditioned trigger, currently 106.2 mm in 24 h against a 1-in-2-year level of 87.3 mm.',
        sources: [
          'Seasonal window: 01 June to 15 October',
          'Seasonal window basis line',
          'Trigger table: 24 h accumulation against trigger level',
        ],
      },
    },
    {
      match: [['structure'], ['389'], ['count'], ['exposure']],
      answer: {
        text:
          'The 389 structure count comes from Module 2, which is not implemented in this build, and the figure carries a STUB chip for that reason. What it claims to be is footprints intersecting the VERY HIGH susceptibility polygon of 1.84 sq km. The population figure of 1,642 is derived from it by multiplying by 4.22 mean household size, so if the structure count moves, that population figure moves with it. The 361 household figure is independent, enumerated from Census records.',
        sources: [
          'Exposure: structures 389, STUB M2 chip',
          'Exposure: population derivation 389 x 4.22',
          'Exposure: households 361, Census provenance',
          'Exposure: footprint 184.0 ha',
        ],
      },
    },
    {
      match: [['published'], ['ksdma'], ['hazard', 'zone'], ['outside'], ['nearest']],
      answer: {
        text:
          'The published classification and the factor model are two different claims and this panel shows both. The KSDMA landslide sheet assigns a three-class zonation; this habitation centroid does not fall inside any mapped polygon, and the nearest High Hazard Zone is 551 m away. The factor model separately computes 81.1 VERY HIGH from slope, lithology and relief. Neither overrides the other: the sheet is authoritative about the ground it maps, and the centroid is a point standing in for an area, so a habitation 551 m from a mapped zone is not the same as a habitation the sheet has cleared.',
        sources: [
          'Published hazard classification: assigned class and nearest-zone distance',
          'Published sheet: KSDMA Wayanad, assessed 10 Aug 2020',
          'Static susceptibility: computed score 81.1',
        ],
      },
    },
    {
      match: [['susceptibility'], ['slope'], ['factor'], ['81']],
      answer: {
        text:
          'Susceptibility is 81.1 from seven weighted factors. The three largest contributions are slope at 22.0 (88 normalised at weight 0.25), lithology at 17.0 (85 at 0.20) and relative relief at 11.7 (78 at 0.15). Historical incidents scores highest of any row at 92 normalised, three events within 5 km since 2018, but carries only weight 0.08 so contributes 7.4.',
        sources: [
          'Susceptibility factor table: slope, lithology, relief rows',
          'Susceptibility factor table: historical incidents row',
          'Contribution column',
        ],
      },
    },
  ],

  /* ------------------------------------------------------- long-term --- */
  TIER_LONG_TERM: [
    {
      match: [['rank'], ['above'], ['why', 'site'], ['meenangadi', 'kottathara'], ['a', 'b']],
      answer: {
        text:
          'Meenangadi scores 80.7 against Kottathara at 76.1, and the gap is almost entirely terrain and capacity. Meenangadi has mean slope 5.8 deg and GSI class LOW, scoring 88 at weight 0.25 for a contribution of 22.0; Kottathara is 11.4 deg and class MODERATE, 71 at 0.25 for 17.8. On capacity Meenangadi carries 804 households against 412 required, scoring 82, while Kottathara carries 448, scoring 64. Kottathara actually beats Meenangadi on infrastructure, 88 to 84, and on administrative proximity, 86 to 79, but those carry 0.15 and 0.10 and cannot close a 4.6 point gap.',
        sources: [
          'Site suitability tables: Meenangadi 80.7, Kottathara 76.1',
          'Terrain rows: 5.8 deg / 88 and 11.4 deg / 71',
          'Capacity rows: 804 hh / 82 and 448 hh / 64',
          'Infrastructure and administrative rows',
        ],
      },
    },
    {
      match: [['thariode'], ['reject'], ['disqualif']],
      answer: {
        text:
          'Thariode is disqualified on terrain, not on score. Mean slope is 24.6 deg against a 15 deg limit and GSI class is HIGH. The rule is a hard disqualification: a resettlement site may not sit in a susceptibility class equal to or worse than the hazard being escaped. Its overall suitability of 55.4 is not the reason it was rejected, and it would still be rejected if that number were higher. Noolpuzha is the other rejection, on land availability: reserved forest inside the Wayanad Wildlife Sanctuary eco-sensitive zone with a notified elephant corridor.',
        sources: [
          'Thariode: disqualifier block, 24.6 deg vs 15 deg threshold',
          'Thariode: GSI class HIGH',
          'Noolpuzha: disqualifier block, forest diversion',
        ],
      },
    },
    {
      match: [['household'], ['804'], ['capacity'], ['hectare'], ['7', 'cent'], ['plot']],
      answer: {
        text:
          'For Meenangadi: 46.8 ha gross, less 6.2 ha above 15 deg slope, 3.4 ha existing built-up and 2.1 ha water body with its 30 m buffer, leaving 35.1 ha net developable. Taking 35 per cent off for roads, drains, school, anganwadi and commons leaves 22.8 ha residential. At the 7 cent norm, which is 0.028328 ha, that is 804 households. The 35 per cent overhead is an assumption and it matters: without it the same site would appear to hold 1,239 households.',
        sources: [
          'Capacity chain: gross 46.8 ha',
          'Capacity chain: three exclusion rows',
          'Capacity chain: 35 per cent infrastructure overhead',
          'Capacity chain: plot norm 7 cents = 0.028328 ha',
        ],
      },
    },
    {
      match: [['mitigation'], ['why', 'not', 'stay'], ['insufficient'], ['in-situ'], ['in', 'situ']],
      answer: {
        text:
          'Four options were assessed and none is sufficient. Slope stabilisation at Rs 41 crore treats the runout path, not the initiation zone 1.9 km upslope. Check dams at Rs 28 crore fall short because the design debris volume from the 2019 Puthumala event exceeded achievable retention by a factor of 6. Early warning at Rs 3.6 crore fails because modelled runout reaches the settlement 4 to 7 minutes after initiation. Partial retreat of the 4 most exposed wards at Rs 62 crore removes 61 per cent of exposed population but leaves 148 households inside the VERY HIGH polygon.',
        sources: [
          'Mitigation assessment: all four option rows',
          'Mitigation summary: initiation zone 1.9 km upslope',
          'Indicative cost column',
        ],
      },
    },
    {
      match: [['withheld'], ['no', 'site'], ['punchirimattom']],
      answer: {
        text:
          'WITHHELD means the criteria for permanent resettlement are met but no candidate destination survives disqualification, so the tier cannot be raised. It is deliberately distinct from NOT FLAGGED. At Punchirimattom all three candidates fail: Muppainad on terrain at 19.8 deg against the 15 deg limit, Vellarimala because it falls inside the same VERY HIGH polygon as the origin, and Pozhuthana on capacity with 70 households against 208 required. Reading that as "no action needed" would be the opposite of what it means.',
        sources: [
          'Tier flag: WITHHELD status and rationale',
          'Candidate table: three rejection rows with disqualifiers',
          'Header: 208 households required',
        ],
      },
    },
  ],

  ROUTING: [],
};

const MISS: Record<ExplainScope, string> = {
  PAN_INDIA:
    'No answer available for that query in this scope. This input answers only from the filters, layer states and tier counts currently displayed in the national view.',
  HABITATION:
    'No answer available for that query in this scope. This input answers only from the header figures and the two score breakdowns currently displayed.',
  TIER_IMMEDIATE:
    'No answer available for that query in this scope. This input answers only from the triggers, camp table and evacuation breakdown currently displayed.',
  TIER_SHORT_TERM:
    'No answer available for that query in this scope. This input answers only from the susceptibility table, exposure figures and seasonal window currently displayed.',
  TIER_LONG_TERM:
    'No answer available for that query in this scope. This input answers only from the mitigation assessment and candidate site tables currently displayed.',
  ROUTING: 'Routing is not in this build.',
  EVAC_ZONES:
    'No answer available for that query in this scope. This input answers only '
    + 'from the exclusion table, constraint rules, suitability weights and '
    + 'candidate list currently displayed for this search area.',
};

export function explain(scope: ExplainScope, query: string) {
  const q = query.toLowerCase();
  for (const entry of ENTRIES[scope]) {
    for (const set of entry.match) {
      if (set.every((w) => q.includes(w))) return entry.answer;
    }
  }
  return { text: MISS[scope], sources: [], miss: true as const };
}
