/**
 * Image helpers for receipt scanning. Everything runs on the device with
 * canvas; nothing is uploaded from here.
 */

export async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}

function drawScaled(bitmap: ImageBitmap, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('encode failed'))),
      type,
      quality
    )
  );
}

/**
 * Grayscale plus auto-levels: the 2nd and 98th percentile of brightness are
 * stretched to black and white. Receipts are low contrast thermal paper, and
 * this is the cheapest step that helps text recognition most.
 */
export async function prepareForOcr(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = drawScaled(bitmap, 1800);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = d[i + 1] = d[i + 2] = g;
    hist[g | 0]++;
  }
  const total = canvas.width * canvas.height;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * 0.02) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= total * 0.02) {
      hi = v;
      break;
    }
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return toBlob(canvas, 'image/png');
}

/** A small picture to keep with the transaction (about 20-40 KB). */
export async function makeThumbnail(
  bitmap: ImageBitmap,
  maxSide = 320,
  quality = 0.6
): Promise<string> {
  const canvas = drawScaled(bitmap, maxSide);
  const blob = await toBlob(canvas, 'image/jpeg', quality);
  return blobToDataUrl(blob);
}

/** A reduced picture for the online reader. */
export async function makeUploadImage(bitmap: ImageBitmap): Promise<Blob> {
  return toBlob(drawScaled(bitmap, 1400), 'image/jpeg', 0.72);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
