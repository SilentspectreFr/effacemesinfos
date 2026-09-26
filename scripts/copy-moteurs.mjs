import { cpSync, mkdirSync } from "node:fs";

function copy(from, to, files) {
  const source = new URL(from, import.meta.url);
  const target = new URL(to, import.meta.url);
  mkdirSync(target, { recursive: true });
  for (const file of files) cpSync(new URL(file, source), new URL(file, target));
}

copy("../node_modules/mupdf/dist/", "../public/mupdf/", ["mupdf.js", "mupdf-wasm.js", "mupdf-wasm.wasm"]);
copy("../node_modules/tesseract.js/dist/", "../public/ocr/", ["worker.min.js"]);
copy("../node_modules/tesseract.js-core/", "../public/ocr/", ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"]);
copy("../node_modules/@tesseract.js-data/fra/4.0.0_best_int/", "../public/ocr/", ["fra.traineddata.gz"]);
