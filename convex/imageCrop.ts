"use node";

/**
 * Crops the source room photo down to one object's bounding box (plus a
 * protective padding margin) and stores the result as its own image — used
 * as the product photo sent to marketplaces instead of the whole room shot.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { boxValidator } from "./schema";
import { Jimp } from "jimp";

/** Same padding fraction as the UI's own cropped thumbnails (ObjectThumb.tsx). */
const PAD = 0.035;

export const cropToBox = internalAction({
  args: { imageUrl: v.string(), box: boxValidator },
  handler: async (ctx, args) => {
    const image = await Jimp.read(args.imageUrl);
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    const x0 = Math.max(0, args.box.x - PAD);
    const y0 = Math.max(0, args.box.y - PAD);
    const x1 = Math.min(1, args.box.x + args.box.width + PAD);
    const y1 = Math.min(1, args.box.y + args.box.height + PAD);

    const cropX = Math.round(x0 * width);
    const cropY = Math.round(y0 * height);
    const cropWidth = Math.max(1, Math.round((x1 - x0) * width));
    const cropHeight = Math.max(1, Math.round((y1 - y0) * height));

    image.crop({ x: cropX, y: cropY, w: cropWidth, h: cropHeight });

    const buffer = await image.getBuffer("image/jpeg");
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array(buffer)], { type: "image/jpeg" }),
    );

    const url = await ctx.storage.getUrl(storageId);
    if (url === null) throw new Error("Could not read back the cropped product photo.");

    return url;
  },
});
