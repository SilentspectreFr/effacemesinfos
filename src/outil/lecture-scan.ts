import { assemblePage, type ReadLine, type ReadPage } from "./texte-lu";

const readingScale = 300 / 72;
const maxPixels = 12_000_000;

export function readingScaleFor([width, height]: [number, number]): number {
  return Math.min(readingScale, Math.sqrt(maxPixels / Math.max(1, width * height)));
}

export interface ScanReader {
  read(png: ArrayBuffer, scale: number): Promise<ReadPage>;
  stop(): Promise<void>;
}

export async function createScanReader(): Promise<ScanReader> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("fra", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/",
    langPath: "/ocr/",
    workerBlobURL: false,
    cacheMethod: "none",
  });
  return {
    async read(png, scale) {
      const image = await evenLighting(png);
      const { data } = await worker.recognize(image, {}, { blocks: true, text: false });
      const lines: ReadLine[] = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => ({
        words: line.words.map((word) => ({ text: word.text, confidence: word.confidence, bbox: word.bbox })),
      }))));
      return assemblePage(lines, scale);
    },
    async stop() {
      await worker.terminate();
    },
  };
}

async function evenLighting(png: ArrayBuffer): Promise<Blob> {
  const bitmap = await createImageBitmap(new Blob([png], { type: "image/png" }));
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = context.getImageData(0, 0, width, height);
  const gray = toGray(image.data);
  const sums = integralOf(gray, width, height);
  const radius = Math.max(8, Math.round(width / 40));
  const stride = width + 1;
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const total = sums[bottom * stride + right]! - sums[top * stride + right]! - sums[bottom * stride + left]! + sums[top * stride + left]!;
      const background = (total >>> 0) / ((bottom - top) * (right - left));
      const index = y * width + x;
      const value = (gray[index]! / (background + 1)) * 255 < 200 ? 0 : 255;
      image.data[index * 4] = image.data[index * 4 + 1] = image.data[index * 4 + 2] = value;
      image.data[index * 4 + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  canvas.width = canvas.height = 0;
  return blob;
}

function toGray(pixels: Uint8ClampedArray): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(pixels.length / 4);
  for (let index = 0; index < gray.length; index++) {
    gray[index] = 0.299 * pixels[index * 4]! + 0.587 * pixels[index * 4 + 1]! + 0.114 * pixels[index * 4 + 2]!;
  }
  return gray;
}

function integralOf(values: Uint8ClampedArray, width: number, height: number): Uint32Array {
  const stride = width + 1;
  const sums = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += values[y * width + x]!;
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1]! + row;
    }
  }
  return sums;
}
