/* ============================================================================
 * PUBLISHED CLASS SAMPLES  --  GENERATED FILE, DO NOT EDIT BY HAND
 *
 * Produced by scripts/sample-published.mjs. Each entry is the class the
 * publisher assigns to the ground a habitation stands on, obtained by
 * point-in-polygon against the supplied KSDMA district sheets.
 *
 * These are LIVE values from a real published product. They are displayed
 * ALONGSIDE the placeholder factor model rather than replacing it, so that a
 * disagreement between the two is visible instead of silently resolved.
 *
 * Regenerate with:  node scripts/sample-published.mjs
 * ==========================================================================*/

export interface PublishedSample {
  /** Publisher's own class string, verbatim. Null when the habitation falls
   *  outside every mapped polygon in the sheet. */
  class: string | null;
  /** Source feature id, for cross-reference against the original shapefile. */
  fid: string | null;
  insideZone: boolean;
  /** Only when insideZone is false: metres to the nearest polygon of each
   *  class, within a 5 km search radius. */
  nearestM?: Record<string, number>;
}

export interface PublishedClasses {
  landslide?: PublishedSample;
  flood?: PublishedSample;
}

export const PUBLISHED_SOURCE = {
  landslide: {
    label: "Landslide hazard zone",
    source: "KSDMA landslide hazard zonation, Wayanad (WAYD_LS.kmz)",
    agency: 'Kerala State Disaster Management Authority',
    assessedOn: "2020-08-10T00:00:00+05:30",
  },
  flood: {
    label: "Flood landform",
    source: "KSDMA flood landform mapping, Wayanad (Wayanad.kmz)",
    agency: 'Kerala State Disaster Management Authority',
    assessedOn: "2018-09-26T00:00:00+05:30",
  },
} as const;

/** Habitation id -> published classes. Absent id means the habitation lies
 *  outside the coverage of every ingested sheet. */
export const PUBLISHED: Record<string, PublishedClasses> = {
  "WYD-CHOORALMALA": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 551,
        "Medium Hazard Zone": 1033
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2201
      }
    }
  },
  "WYD-PUNCHIRIMATTOM": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 3131,
        "Medium Hazard Zone": 2918
      }
    }
  },
  "GEN-KE-0261": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 224,
        "Medium Hazard Zone": 179,
        "Low Hazard Zone": 2552
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2595,
        "Flood plain": 2544
      }
    }
  },
  "GEN-KE-0262": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 504,
        "Medium Hazard Zone": 113,
        "Low Hazard Zone": 3046
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 936,
        "Flood plain": 851
      }
    }
  },
  "GEN-KE-0263": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 4400,
        "Medium Hazard Zone": 3101
      }
    }
  },
  "GEN-KE-0264": {
    "landslide": {
      "class": "High Hazard Zone",
      "fid": "22",
      "insideZone": true
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2558,
        "Flood plain": 2490
      }
    }
  },
  "GEN-KE-0265": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Medium Hazard Zone": 4631
      }
    }
  },
  "GEN-KE-0267": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 2345,
        "Medium Hazard Zone": 1918
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 414,
        "Flood plain": 98
      }
    }
  },
  "GEN-KE-0268": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Medium Hazard Zone": 3605
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 375,
        "Flood plain": 31
      }
    }
  },
  "GEN-KE-0269": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 4973,
        "Medium Hazard Zone": 2319
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 1521,
        "Flood plain": 716
      }
    }
  },
  "GEN-KE-0270": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 868,
        "Medium Hazard Zone": 992,
        "Low Hazard Zone": 3667
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2854,
        "Flood plain": 2563
      }
    }
  },
  "GEN-KE-0271": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Medium Hazard Zone": 4079
      }
    },
    "flood": {
      "class": "Flood plain",
      "fid": "18",
      "insideZone": true
    }
  },
  "GEN-KE-0273": {
    "landslide": {
      "class": "Low Hazard Zone",
      "fid": "255",
      "insideZone": true
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2203
      }
    }
  },
  "GEN-KE-0274": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 2169,
        "Medium Hazard Zone": 1091
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2292,
        "Flood plain": 1777
      }
    }
  },
  "GEN-KE-0275": {
    "landslide": {
      "class": "Medium Hazard Zone",
      "fid": "139",
      "insideZone": true
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 675
      }
    }
  },
  "GEN-KE-0278": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Medium Hazard Zone": 4998
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 961,
        "Flood plain": 50
      }
    }
  },
  "GEN-KE-0279": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Medium Hazard Zone": 3390
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 1237,
        "Flood plain": 141
      }
    }
  },
  "GEN-KE-0280": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 3068,
        "Medium Hazard Zone": 2530
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 859,
        "Flood plain": 34
      }
    }
  },
  "GEN-KE-0281": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 4213,
        "Medium Hazard Zone": 2570
      }
    },
    "flood": {
      "class": "Flood plain",
      "fid": "21",
      "insideZone": true
    }
  },
  "GEN-KE-0282": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 1066,
        "Medium Hazard Zone": 2168
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 3175,
        "Flood plain": 3658
      }
    }
  },
  "GEN-KE-0283": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 3507,
        "Medium Hazard Zone": 1136
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2006,
        "Flood plain": 2440
      }
    }
  },
  "GEN-KE-0284": {
    "landslide": {
      "class": "Medium Hazard Zone",
      "fid": "195",
      "insideZone": true
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2245
      }
    }
  },
  "GEN-KE-0285": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 783,
        "Medium Hazard Zone": 134
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2835,
        "Flood plain": 2742
      }
    }
  },
  "GEN-KE-0286": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 4065,
        "Low Hazard Zone": 4185
      }
    }
  },
  "GEN-KE-0288": {
    "landslide": {
      "class": "High Hazard Zone",
      "fid": "85",
      "insideZone": true
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2047
      }
    }
  },
  "GEN-KE-0289": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 1756,
        "Medium Hazard Zone": 108,
        "Low Hazard Zone": 4981
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 1187
      }
    }
  },
  "GEN-KE-0290": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 1876,
        "Medium Hazard Zone": 4940,
        "Low Hazard Zone": 2317
      }
    }
  },
  "GEN-KE-0291": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 2384,
        "Medium Hazard Zone": 1280
      }
    },
    "flood": {
      "class": "Flood plain",
      "fid": "19",
      "insideZone": true
    }
  },
  "GEN-KE-0292": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 187,
        "Medium Hazard Zone": 186
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2673,
        "Flood plain": 1795
      }
    }
  },
  "GEN-KE-0293": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 4422,
        "Medium Hazard Zone": 2204
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 661,
        "Flood plain": 234
      }
    }
  },
  "GEN-KE-0294": {
    "landslide": {
      "class": "High Hazard Zone",
      "fid": "95",
      "insideZone": true
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2162,
        "Flood plain": 1252
      }
    }
  },
  "GEN-KE-0295": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 711,
        "Medium Hazard Zone": 1274
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2680
      }
    }
  },
  "GEN-KE-0296": {
    "landslide": {
      "class": "Medium Hazard Zone",
      "fid": "187",
      "insideZone": true
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2004
      }
    }
  },
  "GEN-KE-0297": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 1155,
        "Medium Hazard Zone": 393,
        "Low Hazard Zone": 4664
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 4101
      }
    }
  },
  "GEN-KE-0299": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 4883,
        "Medium Hazard Zone": 4803
      }
    }
  },
  "GEN-KE-0300": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 1861,
        "Medium Hazard Zone": 774
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 2562,
        "Flood plain": 1664
      }
    }
  },
  "GEN-KE-0301": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 2933,
        "Medium Hazard Zone": 1012,
        "Low Hazard Zone": 2545
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 345,
        "Flood plain": 2426
      }
    }
  },
  "GEN-KE-0304": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 2686,
        "Medium Hazard Zone": 416
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 846,
        "Flood plain": 1007
      }
    }
  },
  "GEN-KE-0305": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 2221,
        "Medium Hazard Zone": 800
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Flood plain": 204
      }
    }
  },
  "GEN-KE-0306": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 2718,
        "Medium Hazard Zone": 1755
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 4250,
        "Flood plain": 563
      }
    }
  },
  "GEN-KE-0307": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 4447,
        "Medium Hazard Zone": 279
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 3697,
        "Flood plain": 842
      }
    }
  },
  "GEN-KE-0308": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Medium Hazard Zone": 4342
      }
    },
    "flood": {
      "class": "Flood plain",
      "fid": "12",
      "insideZone": true
    }
  },
  "GEN-KE-0309": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "High Hazard Zone": 1382,
        "Medium Hazard Zone": 744
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 4366,
        "Flood plain": 1129
      }
    }
  },
  "GEN-KE-0310": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Medium Hazard Zone": 1226
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Flood plain": 3021
      }
    }
  },
  "GEN-KE-0311": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Medium Hazard Zone": 2503
      }
    },
    "flood": {
      "class": "Flood plain",
      "fid": "10",
      "insideZone": true
    }
  },
  "GEN-KE-0312": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Medium Hazard Zone": 722
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 4751,
        "Flood plain": 459
      }
    }
  },
  "GEN-KE-0313": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Medium Hazard Zone": 3191
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Flood plain": 1846
      }
    }
  },
  "GEN-KE-0314": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Medium Hazard Zone": 1087
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 1325,
        "Flood plain": 403
      }
    }
  },
  "GEN-KE-0315": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Medium Hazard Zone": 3876
      }
    },
    "flood": {
      "class": "Waterbody",
      "fid": "3",
      "insideZone": true
    }
  },
  "GEN-KE-0316": {
    "landslide": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Medium Hazard Zone": 1217
      }
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 4608,
        "Flood plain": 3382
      }
    }
  },
  "GEN-KE-0318": {
    "landslide": {
      "class": "Medium Hazard Zone",
      "fid": "217",
      "insideZone": true
    },
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 3435,
        "Flood plain": 3363
      }
    }
  },
  "GEN-KE-0272": {
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 3650,
        "Flood plain": 1424
      }
    }
  },
  "GEN-KE-0276": {
    "flood": {
      "class": "Flood plain",
      "fid": "18",
      "insideZone": true
    }
  },
  "GEN-KE-0277": {
    "flood": {
      "class": "Flood plain",
      "fid": "12",
      "insideZone": true
    }
  },
  "GEN-KE-0302": {
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 1951,
        "Flood plain": 263
      }
    }
  },
  "GEN-KE-0317": {
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 871,
        "Flood plain": 1102
      }
    }
  },
  "GEN-KE-0319": {
    "flood": {
      "class": null,
      "fid": null,
      "insideZone": false,
      "nearestM": {
        "Waterbody": 1237,
        "Flood plain": 856
      }
    }
  }
};
