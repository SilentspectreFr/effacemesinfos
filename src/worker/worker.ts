import { cleanDocx, imageBytes, inspectDocx, verifyDocx } from "../engine/docx";
import { createPdfEngine, type PdfEngine } from "../engine/pdf";
import type { MupdfModule } from "../engine/types";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const mupdfUrl = "/mupdf/mupdf.js";

let engine: PdfEngine;
let current: Uint8Array | null = null;
let format: "pdf" | "docx" | null = null;

const reply = (message: WorkerResponse, transfer: Transferable[] = []) => postMessage(message, transfer);

const isPdf = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
const isZip = (bytes: Uint8Array) => bytes.length > 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;

async function open(bytes: Uint8Array) {
  if (isPdf(bytes)) {
    current = bytes;
    format = "pdf";
    return { format: "pdf" as const, diagnostic: engine.diagnose(bytes) };
  }
  if (isZip(bytes)) {
    const inspection = await inspectDocx(bytes);
    current = bytes;
    format = "docx";
    return { format: "docx" as const, inspection };
  }
  throw new Error("Format non pris en charge. Choisissez un PDF, un document Word (.docx), un texte (.txt) ou un Markdown (.md, .markdown).");
}

async function handle(request: WorkerRequest) {
  switch (request.type) {
    case "open": {
      const document = await open(new Uint8Array(request.bytes));
      reply({ id: request.id, type: "opened", document });
      return;
    }
    case "render": {
      if (!current || format !== "pdf") throw new Error("Aucun PDF ouvert.");
      const { png, width, height } = engine.render(current, request.page, request.scale);
      reply({ id: request.id, type: "rendered", png: png.buffer as ArrayBuffer, width, height }, [png.buffer as ArrayBuffer]);
      return;
    }
    case "lines": {
      if (!current || format !== "pdf") throw new Error("Aucun PDF ouvert.");
      reply({ id: request.id, type: "lines", lines: engine.lines(current, request.page) });
      return;
    }
    case "locate": {
      if (!current || format !== "pdf") throw new Error("Aucun PDF ouvert.");
      reply({ id: request.id, type: "located", located: engine.locate(current, request.values) });
      return;
    }
    case "exportPdf": {
      if (!current || format !== "pdf") throw new Error("Aucun PDF ouvert.");
      const result = request.mode === "image" ? engine.rasterize(current, request.rects) : engine.clean(current, request.targets, request.rects, request.rasterizePages ?? []);
      const findings = engine.verify(result.bytes, request.targets);
      reply({ id: request.id, type: "exported", bytes: result.bytes.buffer as ArrayBuffer, report: result.report, findings }, [result.bytes.buffer as ArrayBuffer]);
      return;
    }
    case "exportDocx": {
      if (!current || format !== "docx") throw new Error("Aucun document Word ouvert.");
      const result = await cleanDocx(current, request.replacements, request.removedImages);
      const findings = await verifyDocx(result.bytes, request.targets);
      reply({ id: request.id, type: "exported", bytes: result.bytes.buffer as ArrayBuffer, report: result.report, findings }, [result.bytes.buffer as ArrayBuffer]);
      return;
    }
    case "docxImage": {
      if (!current || format !== "docx") throw new Error("Aucun document Word ouvert.");
      const image = await imageBytes(current, request.key);
      const buffer = image ? image.bytes.buffer as ArrayBuffer : null;
      reply({ id: request.id, type: "docxImage", bytes: buffer, media: image?.media ?? "" }, buffer ? [buffer] : []);
      return;
    }
    case "forget": {
      current = null;
      format = null;
      reply({ id: request.id, type: "forgotten" });
      return;
    }
  }
}

addEventListener("message", async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    await handle(data);
  } catch (error) {
    reply({ id: data.id, type: "error", message: error instanceof Error ? error.message : String(error) });
  }
});

try {
  const mupdf = (await import(/* @vite-ignore */ mupdfUrl)) as MupdfModule;
  engine = createPdfEngine(mupdf);
  reply({ id: 0, type: "ready" });
} catch (error) {
  reply({ id: 0, type: "error", message: error instanceof Error ? error.message : String(error) });
}
