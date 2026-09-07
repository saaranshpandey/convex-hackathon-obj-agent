import { motion } from "motion/react";
import { polygonToPath, type DetectedObject } from "@/data/demoObjects";

type Props = {
  objects: DetectedObject[];
  selected: Set<string>;
  hoveredId: string | null;
  activeId: string | null;
  onToggle: (id: string) => void;
  onHover: (id: string | null) => void;
};

export default function ObjectOverlay({
  objects,
  selected,
  hoveredId,
  activeId,
  onToggle,
  onHover,
}: Props) {
  return (
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
    >
      {objects.map((o, i) => {
        const isSelected = selected.has(o.id);
        const isHovered = hoveredId === o.id;
        const isActive = activeId === o.id;

        const fillOpacity = isSelected
          ? isHovered
            ? 0.34
            : 0.2
          : isHovered
            ? 0.14
            : 0;

        const strokeOpacity = isSelected ? 1 : isHovered ? 0.75 : 0.32;

        return (
          <motion.path
            key={o.id}
            d={polygonToPath(o.polygon)}
            // Uniform hairlines despite preserveAspectRatio="none".
            vectorEffect="non-scaling-stroke"
            // "all" keeps fully transparent shapes clickable.
            pointerEvents="all"
            fill="#B8F35A"
            stroke={isSelected ? "#B8F35A" : "#FFFFFF"}
            strokeWidth={isSelected || isActive ? 2 : 1.25}
            strokeLinejoin="round"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, fillOpacity, strokeOpacity }}
            transition={{
              opacity: { duration: 0.42, delay: i * 0.09, ease: "easeOut" },
              fillOpacity: { duration: 0.18 },
              strokeOpacity: { duration: 0.18 },
            }}
            onClick={() => onToggle(o.id)}
            onPointerEnter={() => onHover(o.id)}
            onPointerLeave={() => onHover(null)}
            className="cursor-pointer"
          >
            <title>{o.name}</title>
          </motion.path>
        );
      })}
    </svg>
  );
}
