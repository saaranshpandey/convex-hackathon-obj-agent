/**
 * Mock segmentation output for Phase 1.
 *
 * Polygons are authored in the demo artwork's own pixel space and normalised to
 * 0..1 below, so the overlay is resolution-independent. Swapping in a real
 * photograph later means replacing the asset, SOURCE_W/SOURCE_H, and these
 * point lists — nothing in the components changes.
 */

export type Point = readonly [number, number];

export type DetectedObject = {
  id: string;
  name: string;
  /** Outline in normalised image space (0..1). */
  polygon: Point[];
  /** Tight bounding box of the polygon, normalised. */
  bbox: { x: number; y: number; width: number; height: number };
  defaultSelected: boolean;
};

const SOURCE_W = 1600;
const SOURCE_H = 1000;

type RawObject = {
  id: string;
  name: string;
  points: readonly Point[];
  defaultSelected: boolean;
};

const RAW: RawObject[] = [
  {
    id: "guitar",
    name: "Guitar",
    defaultSelected: true,
    points: [
      [172, 388], [228, 388], [228, 438], [218, 438], [218, 644], [246, 662],
      [272, 694], [282, 730], [272, 776], [296, 806], [305, 844], [292, 898],
      [252, 932], [200, 940], [148, 932], [108, 898], [95, 844], [104, 806],
      [128, 776], [118, 730], [128, 694], [154, 662], [182, 644], [182, 438],
      [172, 438],
    ],
  },
  {
    id: "ps5",
    name: "PS5",
    defaultSelected: true,
    points: [
      [386, 618], [486, 618], [496, 632], [496, 936], [486, 948], [386, 948],
      [376, 936], [376, 632],
    ],
  },
  {
    id: "monitor",
    name: "Monitor",
    defaultSelected: true,
    points: [
      [730, 342], [1050, 342], [1050, 558], [906, 558], [906, 580], [958, 580],
      [958, 598], [822, 598], [822, 580], [874, 580], [874, 558], [730, 558],
    ],
  },
  {
    id: "printer",
    name: "Printer",
    defaultSelected: false,
    points: [
      [1290, 758], [1528, 758], [1528, 792], [1546, 792], [1546, 936],
      [1526, 950], [1292, 950], [1272, 936], [1274, 792], [1290, 792],
    ],
  },
  {
    id: "chair",
    name: "Chair",
    defaultSelected: true,
    points: [
      [956, 588], [1156, 588], [1160, 788], [1194, 798], [1196, 856],
      [1082, 860], [1082, 946], [1168, 990], [1156, 1000], [1056, 958],
      [956, 1000], [944, 990], [1030, 946], [1030, 860], [916, 856],
      [918, 798], [952, 788],
    ],
  },
];

function normalise(raw: RawObject): DetectedObject {
  const polygon: Point[] = raw.points.map(([x, y]) => [x / SOURCE_W, y / SOURCE_H]);
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return {
    id: raw.id,
    name: raw.name,
    polygon,
    bbox: {
      x: minX,
      y: minY,
      width: Math.max(...xs) - minX,
      height: Math.max(...ys) - minY,
    },
    defaultSelected: raw.defaultSelected,
  };
}

export const DEMO_OBJECTS: DetectedObject[] = RAW.map(normalise);

export function polygonToPath(polygon: Point[]): string {
  return `${polygon.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ")} Z`;
}
