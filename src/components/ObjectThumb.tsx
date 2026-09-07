import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  imageUrl: string;
  bbox: { x: number; y: number; width: number; height: number };
  className?: string;
};

const PAD = 0.035;

/** Crops the source image to an object's bounding box using background sizing. */
export default function ObjectThumb({ imageUrl, bbox, className }: Props) {
  const [aspect, setAspect] = useState(1);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalHeight > 0) setAspect(img.naturalWidth / img.naturalHeight);
    };
    img.src = imageUrl;
    return () => {
      img.onload = null;
    };
  }, [imageUrl]);

  const x0 = Math.max(0, bbox.x - PAD);
  const y0 = Math.max(0, bbox.y - PAD);
  const x1 = Math.min(1, bbox.x + bbox.width + PAD);
  const y1 = Math.min(1, bbox.y + bbox.height + PAD);
  const w = Math.max(x1 - x0, 0.001);
  const h = Math.max(y1 - y0, 0.001);

  return (
    <div
      className={cn("shrink-0 overflow-hidden rounded-lg bg-canvas", className)}
      style={{
        aspectRatio: `${w * aspect} / ${h}`,
        backgroundImage: `url("${imageUrl}")`,
        backgroundSize: `${100 / w}% ${100 / h}%`,
        backgroundPosition: `${w < 1 ? (x0 / (1 - w)) * 100 : 0}% ${
          h < 1 ? (y0 / (1 - h)) * 100 : 0
        }%`,
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}
