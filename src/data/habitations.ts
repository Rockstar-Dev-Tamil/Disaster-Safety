/* ============================================================================
 * HABITATION SET
 *
 * The two demo habitations are authored in full (wayanad.ts, kendrapara.ts).
 * The remainder are generated so the map has real density to drill through.
 *
 * Generated points are NOT free of breakdowns. Each carries a full factor
 * table for its hazard type, and the raw ground values are back-computed from
 * the normalised class score through the stated scale, so the "34.2 deg" and
 * the "88" on the same row always correspond. A point whose breakdown does not
 * reconcile would be worse than no point at all.
 *
 * Generation is deterministic (seeded LCG) so the picture is identical on
 * every load and between machines -- an officer comparing two screenshots must
 * not see figures move for no reason.
 * ==========================================================================*/

import { currentCoastalDrivers, currentRainDrivers, factorsFor } from './factory';
import {
  SRC_CENSUS,
  SRC_GSI_NLSM,
  SRC_IMD_NOWCAST,
  SRC_INCOIS_SURGE,
  SRC_NCSCM_SHORELINE,
  SRC_NRSC_FLOOD,
  derive,
} from './sources';
import type { Habitation, HazardType, ImdAlert, Provenance, TierStatus } from './schema';
import { CHOORALMALA, PUNCHIRIMATTOM, WAYANAD_CLOCK } from './wayanad';
import { KANHUPUR } from './kendrapara';

/* The timestamp the GENERATED points were authored against -- not the console's
 * operating clock, which now belongs to the selected case (see data/cases.ts).
 * These two coincide on the Wayanad case and diverge on any other, which is
 * correct: synthetic density points do not acquire observations of an Odisha
 * event just because an officer switched to it. They are marked synthetic in
 * their provenance for exactly this reason. */
/* The single moment the generated national set is observed at.
 *
 * Exported because the derived district-alert overlay aggregates that set and
 * has to state which clock it is reporting: it does NOT follow the selected
 * case, and stamping it with whichever case is active would misdate 356 of the
 * 359 habitations. Only the three authored ones move with their own events. */
export const GENERATED_OBSERVED_AT = WAYANAD_CLOCK;

/* ------------------------------------------------------------ generator  */

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const clamp = (n: number) => Math.max(2, Math.min(98, Math.round(n)));
const f1 = (n: number) => Math.round(n * 10) / 10;

type Row = [string, number, string?, string?];

/* Raw ground values are derived FROM the normalised score through the inverse
 * of the stated scale, so the pair on each row is always self-consistent. */

function landslideRows(n: number[]): Row[] {
  const litho =
    n[1] < 45
      ? 'Laterite over gneiss, mantle 2-4 m'
      : n[1] < 72
        ? 'Gneiss, weathered mantle 4-8 m'
        : 'Charnockite, weathered mantle 8-14 m';
  const lulc =
    n[4] < 40
      ? 'Closed natural forest'
      : n[4] < 68
        ? 'Mixed plantation under canopy'
        : 'Plantation on cut terraces; canopy removed';
  return [
    [`${f1(10 + (n[0] / 100) * 25)} deg mean`, n[0], '0-10 deg = 0, >35 deg = 100 (GSI class break)'],
    [litho, n[1], 'Class score, GSI lithology table'],
    [`${Math.round((n[2] / 100) * 500)} m over 1 km radius`, n[2], '<100 m = 0, >500 m = 100'],
    [`Nearest channel at ${Math.round(500 - (n[3] / 100) * 470)} m`, n[3], 'Inverse distance, 500 m cutoff'],
    [lulc, n[4], 'LULC class score'],
    [`${Math.round(n[5] / 20)} events within 5 km since 2018`, n[5], 'Inventory density, 5 km kernel'],
    [`${f1((n[6] / 100) * 2.5)} km per sq km`, n[6], '0-2.5 km/sq km linear'],
  ];
}

function coastalRows(n: number[]): Row[] {
  return [
    [`-${f1((n[0] / 100) * 15)} m/yr, 1990-2018 (DSAS end-point rate)`, n[0], '0 m/yr = 0, >15 m/yr erosion = 100'],
    [`${f1((n[1] / 100) * 4)} m modelled, 1-in-100-yr cyclone`, n[1], '0 m = 0, >4 m = 100'],
    [`${f1(8 - (n[2] / 100) * 6)} m above MSL`, n[2], '>8 m = 0, <2 m = 100'],
    [`${Math.round(500 - (n[3] / 100) * 460)} m residual mangrove buffer`, n[3], '>500 m = 0, <50 m = 100'],
    [`${Math.round(2000 - (n[4] / 100) * 1800)} m to active shoreline`, n[4], '>2,000 m = 0, <200 m = 100'],
    [`${f1(1 + (n[5] / 100) * 3)} m spring range`, n[5], 'Composite ingress index'],
  ];
}

function floodRows(n: number[]): Row[] {
  return [
    [`Inundated in ${Math.round((n[0] / 100) * 26)} of 26 seasons, 1998-2023`, n[0], 'Frequency ratio, SAR record'],
    [`${f1((n[1] / 100) * 5)} m modelled depth`, n[1], '0 m = 0, >5 m = 100'],
    [`${f1(12 - (n[2] / 100) * 11)} m above drainage line`, n[2], '>12 m = 0, <1 m = 100'],
    [
      n[3] < 45 ? 'Embankment sound, last strengthened 2021' : n[3] < 72 ? 'Embankment fair, 2 weak reaches' : 'Embankment weak, breach history',
      n[3],
      'Condition survey class',
    ],
    [`${Math.round((n[4] / 100) * 45)} days typical inundation`, n[4], '0 days = 0, >45 days = 100'],
    [`${Math.round(n[5] / 12)} events since 2010`, n[5], 'Inventory density'],
  ];
}

function cycloneRows(n: number[]): Row[] {
  return [
    [`${f1((n[0] / 100) * 4)} m modelled, 1-in-100-yr cyclone`, n[0], '0 m = 0, >4 m = 100'],
    [`Basic wind speed ${Math.round(39 + (n[1] / 100) * 22)} m/s (IS 875 Part 3)`, n[1], '39 m/s = 0, 61 m/s = 100'],
    [`${f1(10 - (n[2] / 100) * 8.5)} m above MSL`, n[2], '>10 m = 0, <1.5 m = 100'],
    [`Shelter at ${f1((n[3] / 100) * 9)} km; capacity deficit ${Math.round((n[3] / 100) * 60)} per cent`, n[3], 'Distance + capacity composite'],
    [
      n[4] < 45 ? 'Predominantly pucca' : n[4] < 72 ? 'Mixed pucca and semi-pucca' : 'Predominantly kutcha, thatch roof',
      n[4],
      'Structure class distribution, M2',
    ],
  ];
}

function cloudburstRows(n: number[]): Row[] {
  return [
    [`${Math.round((n[0] / 100) * 120)} mm/h 10-yr return intensity`, n[0], '0 mm/h = 0, >120 mm/h = 100'],
    [`${Math.round(180 - (n[1] / 100) * 165)} min catchment response`, n[1], '>180 min = 0, <15 min = 100'],
    [`Channel at ${Math.round(400 - (n[2] / 100) * 380)} m`, n[2], 'Inverse distance, 400 m cutoff'],
    [`${f1(10 + (n[3] / 100) * 28)} deg mean`, n[3], '0-10 deg = 0, >38 deg = 100'],
    [`${Math.round(n[4] / 25)} events since 2010`, n[4], 'Inventory density'],
  ];
}

const ROWS: Record<HazardType, (n: number[]) => Row[]> = {
  LANDSLIDE: landslideRows,
  COASTAL_EROSION: coastalRows,
  FLOOD: floodRows,
  CYCLONE: cycloneRows,
  CLOUDBURST: cloudburstRows,
};

const HAZARD_SOURCE: Record<HazardType, Provenance> = {
  LANDSLIDE: SRC_GSI_NLSM,
  COASTAL_EROSION: SRC_NCSCM_SHORELINE,
  FLOOD: SRC_NRSC_FLOOD,
  CYCLONE: SRC_INCOIS_SURGE,
  CLOUDBURST: SRC_GSI_NLSM,
};

const COUNTS: Record<HazardType, number> = {
  LANDSLIDE: 7,
  COASTAL_EROSION: 6,
  FLOOD: 6,
  CYCLONE: 5,
  CLOUDBURST: 5,
};

/* ---------------------------------------------------------- anchor table */

type Anchor = [
  name: string,
  state: string,
  district: string,
  block: string,
  lng: number,
  lat: number,
  hazard: HazardType,
  n: number,
  severity: number,
];

const ANCHORS: Anchor[] = [
  // ---- Western Ghats, landslide
  ['Munnar', 'Kerala', 'Idukki', 'Devikulam', 77.0595, 10.0889, 'LANDSLIDE', 4, 0.78],
  ['Cheruthoni', 'Kerala', 'Idukki', 'Idukki', 76.97, 9.85, 'LANDSLIDE', 3, 0.66],
  ['Coonoor', 'Tamil Nadu', 'Nilgiris', 'Coonoor', 76.7958, 11.353, 'LANDSLIDE', 4, 0.74],
  ['Kotagiri', 'Tamil Nadu', 'Nilgiris', 'Kotagiri', 76.86, 11.42, 'LANDSLIDE', 3, 0.7],
  ['Valparai', 'Tamil Nadu', 'Coimbatore', 'Valparai', 76.95, 10.33, 'LANDSLIDE', 3, 0.72],
  ['Kodaikanal', 'Tamil Nadu', 'Dindigul', 'Kodaikanal', 77.489, 10.2381, 'LANDSLIDE', 3, 0.62],
  ['Madikeri', 'Karnataka', 'Kodagu', 'Madikeri', 75.7382, 12.4244, 'LANDSLIDE', 4, 0.73],
  ['Chikmagalur', 'Karnataka', 'Chikkamagaluru', 'Mudigere', 75.772, 13.3161, 'LANDSLIDE', 3, 0.64],
  ['Mahabaleshwar', 'Maharashtra', 'Satara', 'Mahabaleshwar', 73.6586, 17.9307, 'LANDSLIDE', 3, 0.68],
  ['Chiplun', 'Maharashtra', 'Ratnagiri', 'Chiplun', 73.515, 17.53, 'LANDSLIDE', 3, 0.66],
  ['Mahad', 'Maharashtra', 'Raigad', 'Mahad', 73.418, 18.08, 'LANDSLIDE', 3, 0.71],
  // ---- Himalaya, landslide
  ['Joshimath', 'Uttarakhand', 'Chamoli', 'Joshimath', 79.5615, 30.5556, 'LANDSLIDE', 4, 0.83],
  ['Rudraprayag', 'Uttarakhand', 'Rudraprayag', 'Rudraprayag', 78.98, 30.2844, 'LANDSLIDE', 3, 0.74],
  ['Uttarkashi', 'Uttarakhand', 'Uttarkashi', 'Bhatwari', 78.45, 30.73, 'LANDSLIDE', 3, 0.76],
  ['Pauri', 'Uttarakhand', 'Pauri Garhwal', 'Pauri', 78.78, 30.15, 'LANDSLIDE', 2, 0.6],
  ['Almora', 'Uttarakhand', 'Almora', 'Almora', 79.66, 29.59, 'LANDSLIDE', 2, 0.58],
  ['Pithoragarh', 'Uttarakhand', 'Pithoragarh', 'Munsiyari', 80.21, 29.58, 'LANDSLIDE', 3, 0.72],
  ['Reckong Peo', 'Himachal Pradesh', 'Kinnaur', 'Kalpa', 78.27, 31.54, 'LANDSLIDE', 3, 0.75],
  ['Kullu', 'Himachal Pradesh', 'Kullu', 'Kullu', 77.109, 31.9578, 'LANDSLIDE', 3, 0.69],
  ['Mandi', 'Himachal Pradesh', 'Mandi', 'Mandi', 76.932, 31.708, 'LANDSLIDE', 3, 0.67],
  ['Shimla', 'Himachal Pradesh', 'Shimla', 'Shimla', 77.1734, 31.1048, 'LANDSLIDE', 3, 0.61],
  ['Ramban', 'Jammu and Kashmir', 'Ramban', 'Ramban', 75.24, 33.24, 'LANDSLIDE', 3, 0.79],
  ['Doda', 'Jammu and Kashmir', 'Doda', 'Doda', 75.547, 33.148, 'LANDSLIDE', 3, 0.72],
  ['Poonch', 'Jammu and Kashmir', 'Punch', 'Punch', 74.09, 33.77, 'LANDSLIDE', 2, 0.63],
  // ---- Eastern Himalaya and North East, landslide
  ['Darjeeling', 'West Bengal', 'Darjeeling', 'Darjeeling', 88.2627, 27.036, 'LANDSLIDE', 4, 0.77],
  ['Kalimpong', 'West Bengal', 'Kalimpong', 'Kalimpong', 88.47, 27.07, 'LANDSLIDE', 3, 0.73],
  ['Gangtok', 'Sikkim', 'Gangtok', 'Gangtok', 88.6065, 27.3314, 'LANDSLIDE', 3, 0.71],
  ['Tawang', 'Arunachal Pradesh', 'Tawang', 'Tawang', 91.87, 27.586, 'LANDSLIDE', 2, 0.68],
  ['Itanagar', 'Arunachal Pradesh', 'Papum Pare', 'Itanagar', 93.61, 27.084, 'LANDSLIDE', 3, 0.66],
  ['Aizawl', 'Mizoram', 'Aizawl', 'Aizawl', 92.7176, 23.7271, 'LANDSLIDE', 4, 0.75],
  ['Kohima', 'Nagaland', 'Kohima', 'Kohima', 94.11, 25.6747, 'LANDSLIDE', 3, 0.7],
  ['Churachandpur', 'Manipur', 'Churachandpur', 'Churachandpur', 93.68, 24.33, 'LANDSLIDE', 2, 0.64],
  ['Ukhrul', 'Manipur', 'Ukhrul', 'Ukhrul', 94.36, 25.05, 'LANDSLIDE', 2, 0.62],
  ['Sohra', 'Meghalaya', 'East Khasi Hills', 'Sohra', 91.73, 25.27, 'LANDSLIDE', 3, 0.72],
  // ---- Brahmaputra and Ganga plains, flood
  ['Majuli', 'Assam', 'Majuli', 'Majuli', 94.22, 26.95, 'FLOOD', 4, 0.82],
  ['Dhemaji', 'Assam', 'Dhemaji', 'Dhemaji', 94.58, 27.48, 'FLOOD', 4, 0.8],
  ['North Lakhimpur', 'Assam', 'Lakhimpur', 'Lakhimpur', 94.1, 27.23, 'FLOOD', 3, 0.76],
  ['Barpeta', 'Assam', 'Barpeta', 'Barpeta', 91.01, 26.32, 'FLOOD', 4, 0.78],
  ['Goalpara', 'Assam', 'Goalpara', 'Goalpara', 90.62, 26.17, 'FLOOD', 3, 0.74],
  ['Silchar', 'Assam', 'Cachar', 'Silchar', 92.78, 24.83, 'FLOOD', 3, 0.75],
  ['Hojai', 'Assam', 'Hojai', 'Hojai', 92.85, 26.0, 'FLOOD', 2, 0.66],
  ['Darbhanga', 'Bihar', 'Darbhanga', 'Darbhanga', 85.89, 26.15, 'FLOOD', 4, 0.81],
  ['Madhubani', 'Bihar', 'Madhubani', 'Madhubani', 86.07, 26.35, 'FLOOD', 3, 0.77],
  ['Supaul', 'Bihar', 'Supaul', 'Supaul', 86.6, 26.12, 'FLOOD', 4, 0.84],
  ['Saharsa', 'Bihar', 'Saharsa', 'Saharsa', 86.6, 25.88, 'FLOOD', 3, 0.79],
  ['Sitamarhi', 'Bihar', 'Sitamarhi', 'Sitamarhi', 85.48, 26.6, 'FLOOD', 3, 0.76],
  ['Bettiah', 'Bihar', 'West Champaran', 'Bettiah', 84.5, 26.8, 'FLOOD', 3, 0.72],
  ['Katihar', 'Bihar', 'Katihar', 'Katihar', 87.58, 25.54, 'FLOOD', 3, 0.74],
  ['Gorakhpur', 'Uttar Pradesh', 'Gorakhpur', 'Gorakhpur', 83.37, 26.76, 'FLOOD', 3, 0.71],
  ['Bahraich', 'Uttar Pradesh', 'Bahraich', 'Bahraich', 81.59, 27.57, 'FLOOD', 3, 0.73],
  ['Ballia', 'Uttar Pradesh', 'Ballia', 'Ballia', 84.15, 25.76, 'FLOOD', 3, 0.7],
  ['Malda', 'West Bengal', 'Malda', 'Manikchak', 88.14, 25.01, 'FLOOD', 3, 0.75],
  ['Murshidabad', 'West Bengal', 'Murshidabad', 'Jangipur', 88.27, 24.18, 'FLOOD', 3, 0.71],
  ['Jalpaiguri', 'West Bengal', 'Jalpaiguri', 'Jalpaiguri', 88.72, 26.52, 'FLOOD', 2, 0.68],
  ['Cooch Behar', 'West Bengal', 'Cooch Behar', 'Cooch Behar', 89.44, 26.32, 'FLOOD', 2, 0.66],
  ['Kuttanad', 'Kerala', 'Alappuzha', 'Kuttanad', 76.42, 9.4, 'FLOOD', 3, 0.77],
  ['Chalakudy', 'Kerala', 'Thrissur', 'Chalakudy', 76.33, 10.3, 'FLOOD', 3, 0.72],
  ['Aluva', 'Kerala', 'Ernakulam', 'Aluva', 76.35, 10.11, 'FLOOD', 2, 0.68],
  ['Kolhapur', 'Maharashtra', 'Kolhapur', 'Karvir', 74.24, 16.7, 'FLOOD', 3, 0.74],
  ['Sangli', 'Maharashtra', 'Sangli', 'Miraj', 74.57, 16.85, 'FLOOD', 3, 0.72],
  ['Bhimavaram', 'Andhra Pradesh', 'West Godavari', 'Bhimavaram', 81.52, 16.54, 'FLOOD', 3, 0.7],
  ['Rajahmundry', 'Andhra Pradesh', 'East Godavari', 'Rajahmundry', 81.78, 17.0, 'FLOOD', 3, 0.69],
  ['Jajpur', 'Odisha', 'Jajpur', 'Jajpur', 86.33, 20.85, 'FLOOD', 3, 0.73],
  ['Bhadrak', 'Odisha', 'Bhadrak', 'Bhadrak', 86.51, 21.06, 'FLOOD', 3, 0.72],
  // ---- Coast, cyclone
  ['Gopalpur', 'Odisha', 'Ganjam', 'Chhatrapur', 84.91, 19.26, 'CYCLONE', 3, 0.76],
  ['Balasore', 'Odisha', 'Balasore', 'Balasore', 86.94, 21.49, 'CYCLONE', 3, 0.74],
  ['Srikakulam', 'Andhra Pradesh', 'Srikakulam', 'Srikakulam', 83.9, 18.3, 'CYCLONE', 3, 0.75],
  ['Visakhapatnam', 'Andhra Pradesh', 'Visakhapatnam', 'Bheemunipatnam', 83.2185, 17.6868, 'CYCLONE', 3, 0.68],
  ['Nellore', 'Andhra Pradesh', 'Nellore', 'Nellore', 79.98, 14.44, 'CYCLONE', 3, 0.71],
  ['Cuddalore', 'Tamil Nadu', 'Cuddalore', 'Cuddalore', 79.76, 11.75, 'CYCLONE', 3, 0.73],
  ['Nagapattinam', 'Tamil Nadu', 'Nagapattinam', 'Nagapattinam', 79.84, 10.77, 'CYCLONE', 3, 0.75],
  ['Ramanathapuram', 'Tamil Nadu', 'Ramanathapuram', 'Ramanathapuram', 78.83, 9.37, 'CYCLONE', 2, 0.66],
  ['Sagar', 'West Bengal', 'South 24 Parganas', 'Sagar', 88.09, 21.65, 'CYCLONE', 3, 0.8],
  ['Gosaba', 'West Bengal', 'South 24 Parganas', 'Gosaba', 88.81, 22.16, 'CYCLONE', 3, 0.78],
  ['Digha', 'West Bengal', 'Purba Medinipur', 'Ramnagar', 87.52, 21.62, 'CYCLONE', 2, 0.72],
  ['Basirhat', 'West Bengal', 'North 24 Parganas', 'Hingalganj', 88.87, 22.66, 'CYCLONE', 3, 0.76],
  ['Mandvi', 'Gujarat', 'Kachchh', 'Mandvi', 69.35, 22.83, 'CYCLONE', 2, 0.67],
  ['Porbandar', 'Gujarat', 'Porbandar', 'Porbandar', 69.61, 21.64, 'CYCLONE', 2, 0.64],
  ['Valsad', 'Gujarat', 'Valsad', 'Valsad', 72.93, 20.61, 'CYCLONE', 2, 0.62],
  ['Alibag', 'Maharashtra', 'Raigad', 'Alibag', 72.87, 18.64, 'CYCLONE', 2, 0.6],
  // ---- Coast, erosion
  ['Poompuhar', 'Tamil Nadu', 'Mayiladuthurai', 'Sirkazhi', 79.85, 11.14, 'COASTAL_EROSION', 2, 0.74],
  ['Chellanam', 'Kerala', 'Ernakulam', 'Kochi', 76.27, 9.83, 'COASTAL_EROSION', 3, 0.79],
  ['Alappad', 'Kerala', 'Kollam', 'Karunagappally', 76.52, 9.15, 'COASTAL_EROSION', 2, 0.77],
  ['Valiyathura', 'Kerala', 'Thiruvananthapuram', 'Thiruvananthapuram', 76.94, 8.46, 'COASTAL_EROSION', 2, 0.75],
  ['Ullal', 'Karnataka', 'Dakshina Kannada', 'Mangaluru', 74.84, 12.8, 'COASTAL_EROSION', 2, 0.76],
  ['Malpe', 'Karnataka', 'Udupi', 'Udupi', 74.7, 13.35, 'COASTAL_EROSION', 2, 0.68],
  ['Puri', 'Odisha', 'Puri', 'Puri', 85.83, 19.81, 'COASTAL_EROSION', 3, 0.73],
  ['Karaikal', 'Puducherry', 'Karaikal', 'Karaikal', 79.83, 10.92, 'COASTAL_EROSION', 2, 0.7],
  // ---- Cloudburst
  ['Leh', 'Ladakh', 'Leh', 'Leh', 77.58, 34.16, 'CLOUDBURST', 2, 0.7],
  ['Kishtwar', 'Jammu and Kashmir', 'Kishtwar', 'Kishtwar', 75.77, 33.31, 'CLOUDBURST', 2, 0.74],
  ['Keylong', 'Himachal Pradesh', 'Lahaul and Spiti', 'Lahaul', 77.03, 32.57, 'CLOUDBURST', 2, 0.72],
  ['Dharamshala', 'Himachal Pradesh', 'Kangra', 'Dharamshala', 76.32, 32.22, 'CLOUDBURST', 2, 0.66],
  // ---- Wayanad district fill (real grama panchayats)
  ['Thirunelly', 'Kerala', 'Wayanad', 'Mananthavady', 76.0, 11.9, 'LANDSLIDE', 2, 0.62],
  ['Thondernad', 'Kerala', 'Wayanad', 'Mananthavady', 75.93, 11.83, 'LANDSLIDE', 2, 0.6],
  ['Thavinjal', 'Kerala', 'Wayanad', 'Mananthavady', 75.9, 11.87, 'LANDSLIDE', 2, 0.64],
  ['Vellamunda', 'Kerala', 'Wayanad', 'Mananthavady', 75.95, 11.76, 'LANDSLIDE', 2, 0.58],
  ['Edavaka', 'Kerala', 'Wayanad', 'Mananthavady', 76.03, 11.78, 'LANDSLIDE', 2, 0.56],
  ['Panamaram', 'Kerala', 'Wayanad', 'Panamaram', 76.0667, 11.7333, 'LANDSLIDE', 2, 0.55],
  ['Padinjarathara', 'Kerala', 'Wayanad', 'Panamaram', 75.95, 11.6833, 'LANDSLIDE', 3, 0.7],
  ['Kaniyambetta', 'Kerala', 'Wayanad', 'Kalpetta', 76.1, 11.65, 'LANDSLIDE', 2, 0.6],
  ['Kottathara', 'Kerala', 'Wayanad', 'Kalpetta', 76.05, 11.6331, 'LANDSLIDE', 2, 0.52],
  ['Vengappally', 'Kerala', 'Wayanad', 'Kalpetta', 76.09, 11.62, 'LANDSLIDE', 2, 0.54],
  ['Muttil', 'Kerala', 'Wayanad', 'Kalpetta', 76.12, 11.6, 'LANDSLIDE', 2, 0.58],
  ['Thariode', 'Kerala', 'Wayanad', 'Vythiri', 76.0, 11.6, 'LANDSLIDE', 2, 0.71],
  ['Pozhuthana', 'Kerala', 'Wayanad', 'Vythiri', 76.0169, 11.5502, 'LANDSLIDE', 2, 0.68],
  ['Vythiri', 'Kerala', 'Wayanad', 'Vythiri', 76.0387, 11.5522, 'LANDSLIDE', 3, 0.72],
  ['Chundale', 'Kerala', 'Wayanad', 'Vythiri', 76.075, 11.575, 'LANDSLIDE', 2, 0.66],
  ['Meppadi', 'Kerala', 'Wayanad', 'Kalpetta', 76.1381, 11.5486, 'LANDSLIDE', 3, 0.79],
  ['Mundakkai', 'Kerala', 'Wayanad', 'Kalpetta', 76.098, 11.462, 'LANDSLIDE', 2, 0.86],
  ['Attamala', 'Kerala', 'Wayanad', 'Kalpetta', 76.121, 11.478, 'LANDSLIDE', 2, 0.84],
  ['Muppainad', 'Kerala', 'Wayanad', 'Vythiri', 76.1004, 11.5168, 'LANDSLIDE', 2, 0.74],
  ['Noolpuzha', 'Kerala', 'Wayanad', 'Sulthan Bathery', 76.35, 11.6, 'LANDSLIDE', 2, 0.48],
  ['Meenangadi', 'Kerala', 'Wayanad', 'Sulthan Bathery', 76.2168, 11.6334, 'LANDSLIDE', 2, 0.42],
  ['Nenmeni', 'Kerala', 'Wayanad', 'Sulthan Bathery', 76.2834, 11.6002, 'LANDSLIDE', 2, 0.4],
  ['Ambalavayal', 'Kerala', 'Wayanad', 'Sulthan Bathery', 76.2, 11.6167, 'LANDSLIDE', 2, 0.46],
  ['Poothadi', 'Kerala', 'Wayanad', 'Sulthan Bathery', 76.18, 11.72, 'LANDSLIDE', 2, 0.5],
  ['Pulpally', 'Kerala', 'Wayanad', 'Sulthan Bathery', 76.1667, 11.7833, 'LANDSLIDE', 2, 0.47],
  ['Mullankolly', 'Kerala', 'Wayanad', 'Sulthan Bathery', 76.13, 11.81, 'LANDSLIDE', 2, 0.45],
  ['Kidanganad', 'Kerala', 'Wayanad', 'Sulthan Bathery', 76.24, 11.68, 'LANDSLIDE', 2, 0.44],
  ['Nallurnad', 'Kerala', 'Wayanad', 'Mananthavady', 76.02, 11.84, 'LANDSLIDE', 2, 0.57],
  // ---- Kendrapara district fill (real coastal and inland villages)
  ['Talachua', 'Odisha', 'Kendrapara', 'Rajnagar', 86.9102, 20.6902, 'COASTAL_EROSION', 2, 0.82],
  ['Gupti', 'Odisha', 'Kendrapara', 'Rajnagar', 86.8501, 20.6902, 'COASTAL_EROSION', 2, 0.79],
  ['Batighar', 'Odisha', 'Kendrapara', 'Rajnagar', 86.96, 20.66, 'COASTAL_EROSION', 2, 0.85],
  ['Barahipur', 'Odisha', 'Kendrapara', 'Rajnagar', 86.92, 20.61, 'COASTAL_EROSION', 2, 0.83],
  ['Gobindapur', 'Odisha', 'Kendrapara', 'Rajnagar', 86.95, 20.6, 'COASTAL_EROSION', 2, 0.81],
  ['Magarkanda', 'Odisha', 'Kendrapara', 'Rajnagar', 86.9, 20.59, 'COASTAL_EROSION', 2, 0.78],
  ['Kharinasi', 'Odisha', 'Kendrapara', 'Mahakalapada', 86.9, 20.42, 'COASTAL_EROSION', 2, 0.8],
  ['Jamboo', 'Odisha', 'Kendrapara', 'Mahakalapada', 86.9804, 20.3201, 'COASTAL_EROSION', 2, 0.84],
  ['Petchhela', 'Odisha', 'Kendrapara', 'Mahakalapada', 86.86, 20.38, 'CYCLONE', 2, 0.76],
  ['Tantiapal', 'Odisha', 'Kendrapara', 'Mahakalapada', 86.82, 20.44, 'CYCLONE', 2, 0.72],
  ['Ramnagar', 'Odisha', 'Kendrapara', 'Rajnagar', 86.8, 20.58, 'CYCLONE', 2, 0.7],
  ['Rajnagar', 'Odisha', 'Kendrapara', 'Rajnagar', 86.7312, 20.6218, 'FLOOD', 2, 0.54],
  ['Rajkanika', 'Odisha', 'Kendrapara', 'Rajkanika', 86.6201, 20.6154, 'FLOOD', 2, 0.5],
  ['Pattamundai', 'Odisha', 'Kendrapara', 'Pattamundai', 86.5702, 20.5901, 'FLOOD', 2, 0.56],
  ['Marshaghai', 'Odisha', 'Kendrapara', 'Marshaghai', 86.6604, 20.4218, 'FLOOD', 2, 0.52],
  ['Aul', 'Odisha', 'Kendrapara', 'Aul', 86.6, 20.68, 'FLOOD', 2, 0.58],
  ['Garadpur', 'Odisha', 'Kendrapara', 'Garadpur', 86.42, 20.5, 'FLOOD', 2, 0.48],
  ['Derabish', 'Odisha', 'Kendrapara', 'Derabish', 86.35, 20.62, 'FLOOD', 2, 0.46],
];

/* Hamlet qualifiers follow revenue-record usage rather than invented names. */
const QUALIFIERS = ['', ' (Upper)', ' (Lower)', ' (North)', ' (East)', ' (West)', ' (South)'];

function tiersFrom(susc: number, current: number, rnd: () => number): Record<'IMMEDIATE' | 'SHORT_TERM' | 'LONG_TERM', TierStatus> {
  const immediate: TierStatus = current >= 70 ? 'FLAGGED' : 'NOT_FLAGGED';
  const shortTerm: TierStatus = susc >= 60 ? 'FLAGGED' : 'NOT_FLAGGED';
  let longTerm: TierStatus = 'NOT_FLAGGED';
  if (susc >= 75) longTerm = rnd() < 0.72 ? 'FLAGGED' : 'WITHHELD';
  return { IMMEDIATE: immediate, SHORT_TERM: shortTerm, LONG_TERM: longTerm };
}

function alertFrom(score: number): ImdAlert {
  if (score >= 78) return 'RED';
  if (score >= 58) return 'ORANGE';
  if (score >= 35) return 'YELLOW';
  return 'GREEN';
}

const RAIN_HAZARDS: HazardType[] = ['LANDSLIDE', 'FLOOD', 'CLOUDBURST'];

function generate(): Habitation[] {
  const rnd = lcg(20260826);
  const out: Habitation[] = [];

  for (const [name, state, district, block, lng, lat, hazard, n, severity] of ANCHORS) {
    for (let i = 0; i < n; i++) {
      const count = COUNTS[hazard];
      const norms: number[] = [];
      for (let k = 0; k < count; k++) {
        norms.push(clamp(severity * 100 + (rnd() - 0.5) * 34));
      }

      const susceptibility = derive(
        factorsFor(hazard, ROWS[hazard](norms)),
        HAZARD_SOURCE[hazard],
      );

      const isRain = RAIN_HAZARDS.includes(hazard);
      /* Operational state is driven by the feed, so it diverges from the
       * standing assessment -- that divergence is the point of two scores. */
      const wet = rnd();
      const current = isRain
        ? derive(
            currentRainDrivers([
              [`${Math.round(120 + wet * 380)} mm since 28 Jul 23:30 (threshold 300 mm)`, clamp(30 + wet * 70)],
              [`${Math.round(80 + wet * 300)} mm (threshold 204.5 mm)`, clamp(28 + wet * 72)],
              [`${susceptibility.score} (${susceptibility.band.replace('_', ' ')})`, clamp(susceptibility.score)],
              [`${Math.round(12 + wet * 85)} mm (threshold 60 mm)`, clamp(20 + wet * 76)],
            ]),
            { ...SRC_IMD_NOWCAST, observedAt: GENERATED_OBSERVED_AT },
          )
        : derive(
            currentCoastalDrivers([
              ['None in Bay of Bengal within 72 h', 8],
              [`${susceptibility.score} (${susceptibility.band.replace('_', ' ')})`, clamp(susceptibility.score)],
              ['Neap tide; next spring tide 04 Aug', clamp(28 + wet * 22)],
              [`Swell ${(1.1 + wet * 1.4).toFixed(1)} m; no INCOIS high-wave alert`, clamp(18 + wet * 26)],
              [`Monsoon westerly, ${Math.round(18 + wet * 26)} km/h onshore component`, clamp(30 + wet * 30)],
            ]),
            { ...SRC_INCOIS_SURGE, observedAt: GENERATED_OBSERVED_AT },
          );

      const households = 60 + Math.floor(rnd() * 540);
      const meanSize = 4.1 + rnd() * 0.9;

      out.push({
        id: `GEN-${state.slice(0, 2).toUpperCase()}-${out.length.toString().padStart(4, '0')}`,
        name: name + QUALIFIERS[i % QUALIFIERS.length],
        block,
        district,
        state,
        lngLat: [
          Math.round((lng + (rnd() - 0.5) * 0.16) * 1e4) / 1e4,
          Math.round((lat + (rnd() - 0.5) * 0.16) * 1e4) / 1e4,
        ],
        population: Math.round(households * meanSize),
        households,
        lgdCode: String(200000 + Math.floor(rnd() * 700000)),
        hazards: [hazard],
        susceptibility,
        current: {
          score: current.score,
          alert: alertFrom(current.score),
          drivers: current.factors,
          observedAt: GENERATED_OBSERVED_AT,
          provenance: isRain
            ? { ...SRC_IMD_NOWCAST, observedAt: GENERATED_OBSERVED_AT }
            : { ...SRC_INCOIS_SURGE, observedAt: GENERATED_OBSERVED_AT },
        },
        tiers: tiersFrom(susceptibility.score, current.score, rnd),
      });
    }
  }
  return out;
}

/* Authored habitations first so they win any id collision and sort stably. */
export const HABITATIONS: Habitation[] = [
  CHOORALMALA,
  PUNCHIRIMATTOM,
  KANHUPUR,
  ...generate(),
];

export const HABITATION_BY_ID = new Map(HABITATIONS.map((h) => [h.id, h]));

export const STATES = Array.from(new Set(HABITATIONS.map((h) => h.state))).sort();

/** Census provenance is uniform across the set; surfaced on the header figures. */
export const POPULATION_PROVENANCE = SRC_CENSUS;
