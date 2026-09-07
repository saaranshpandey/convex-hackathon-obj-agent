/**
 * Mock segmentation output, authored in the demo artwork's pixel space and
 * normalised to 0..1 so it is resolution independent.
 *
 * Phase 3 replaces the consumer of this module with a real detection action;
 * the shape it produces ({ name, category, confidence, polygon }) is the
 * contract that stays fixed.
 */

const SOURCE_W = 1600;
const SOURCE_H = 1000;

type RawItem = {
  name: string;
  category: string;
  confidence: number;
  selected: boolean;
  points: readonly (readonly [number, number])[];
};

const RAW: RawItem[] = [
  {
    name: "Guitar",
    category: "Musical Instruments",
    confidence: 0.93,
    selected: true,
    points: [
      [172, 388], [228, 388], [228, 438], [218, 438], [218, 644], [246, 662],
      [272, 694], [282, 730], [272, 776], [296, 806], [305, 844], [292, 898],
      [252, 932], [200, 940], [148, 932], [108, 898], [95, 844], [104, 806],
      [128, 776], [118, 730], [128, 694], [154, 662], [182, 644], [182, 438],
      [172, 438],
    ],
  },
  {
    name: "PS5",
    category: "Video Game Consoles",
    confidence: 0.97,
    selected: true,
    points: [
      [386, 618], [486, 618], [496, 632], [496, 936], [486, 948], [386, 948],
      [376, 936], [376, 632],
    ],
  },
  {
    name: "Monitor",
    category: "Computer Monitors",
    confidence: 0.95,
    selected: true,
    points: [
      [730, 342], [1050, 342], [1050, 558], [906, 558], [906, 580], [958, 580],
      [958, 598], [822, 598], [822, 580], [874, 580], [874, 558], [730, 558],
    ],
  },
  {
    name: "Printer",
    category: "Printers",
    confidence: 0.89,
    selected: false,
    points: [
      [1290, 758], [1528, 758], [1528, 792], [1546, 792], [1546, 936],
      [1526, 950], [1292, 950], [1272, 936], [1274, 792], [1290, 792],
    ],
  },
  {
    name: "Chair",
    category: "Office Chairs",
    confidence: 0.91,
    selected: true,
    points: [
      [956, 588], [1156, 588], [1160, 788], [1194, 798], [1196, 856],
      [1082, 860], [1082, 946], [1168, 990], [1156, 1000], [1056, 958],
      [956, 1000], [944, 990], [1030, 946], [1030, 860], [916, 856],
      [918, 798], [952, 788],
    ],
  },
];

export type MockDetection = {
  name: string;
  category: string;
  confidence: number;
  selected: boolean;
  polygon: { x: number; y: number }[];
};

export const MOCK_DETECTIONS: MockDetection[] = RAW.map((raw) => ({
  name: raw.name,
  category: raw.category,
  confidence: raw.confidence,
  selected: raw.selected,
  polygon: raw.points.map(([x, y]) => ({ x: x / SOURCE_W, y: y / SOURCE_H })),
}));
