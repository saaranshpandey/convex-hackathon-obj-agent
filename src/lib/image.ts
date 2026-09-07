/** Longest edge we keep. Masks come back at the source image's resolution, so
 *  uploading a 5120px photo means ten multi-megabyte mask PNGs to store and
 *  load. The canvas never displays above ~1000px, so this costs nothing
 *  visible and saves a great deal everywhere else. */
const MAX_EDGE = 2048;

export type PreparedImage = {
  blob: Blob;
  width: number;
  height: number;
};

function loadImage(blob: Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

/**
 * Measures the image and, when it is larger than MAX_EDGE, re-encodes a
 * smaller copy. Everything downstream — detection boxes, mask prompts, mask
 * PNGs — then shares one coordinate space.
 */
export async function prepareUpload(file: Blob): Promise<PreparedImage> {
  const image = await loadImage(file);
  if (image === null || image.naturalWidth === 0) {
    // Unreadable here (e.g. an exotic format); let the backend deal with it.
    return { blob: file, width: 0, height: 0 };
  }

  const { naturalWidth: width, naturalHeight: height } = image;
  const longest = Math.max(width, height);
  if (longest <= MAX_EDGE) return { blob: file, width, height };

  const scale = MAX_EDGE / longest;
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (context === null) return { blob: file, width, height };

  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const resized = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );

  return resized
    ? { blob: resized, width: targetWidth, height: targetHeight }
    : { blob: file, width, height };
}
