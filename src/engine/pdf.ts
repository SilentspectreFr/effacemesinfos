import { hasMarkedContentCaptions, removeMarkedContentCaptions, rewriteNextLineShowOperators, usesNextLineShowOperators } from "./content";
import type { Located, MupdfModule, PdfDiagnostic, PdfReport, Rect, TextLine } from "./types";

type PdfDocument = InstanceType<MupdfModule["PDFDocument"]>;
type PdfPage = InstanceType<MupdfModule["PDFPage"]>;

const rootKeysRemoved = ["Metadata", "Outlines", "Names", "AcroForm", "OpenAction", "AA", "Dests", "Collection", "PieceInfo", "SpiderInfo", "Threads", "StructTreeRoot", "MarkInfo"];
const infoKeys = ["Author", "Title", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate"];
const captionKeysRemoved = ["Alt", "ActualText", "E"];
const rootKeysChecked = ["Metadata", "Outlines", "Names", "AcroForm", "OpenAction", "AA"];

const quadToRect = (q: number[]): Rect => [Math.min(q[0]!, q[4]!), Math.min(q[1]!, q[5]!), Math.max(q[2]!, q[6]!), Math.max(q[3]!, q[7]!)];

const wordCharacter = /[\p{L}\p{N}]/u;

type Glyph = { rect: Rect; baseline: number; height: number };

function glyphs(page: PdfPage): Glyph[] {
  const found: Glyph[] = [];
  const text = page.toStructuredText("preserve-whitespace");
  text.walk({ onChar: (c, _origin, _font, _size, quad) => {
    if (!wordCharacter.test(c) || Math.abs(quad[1] - quad[3]) > 0.01) return;
    found.push({ rect: quadToRect(quad), baseline: quad[5], height: quad[5] - quad[1] });
  } });
  text.destroy();
  return found;
}

function glued(letters: Glyph[], quad: number[], side: "start" | "end") {
  if (Math.abs(quad[1]! - quad[3]!) > 0.01) return false;
  const [x0, , x1] = quadToRect(quad);
  const height = quad[5]! - quad[1]!;
  const tolerance = height * 0.15;
  return letters.some((g) => {
    if (Math.abs(g.baseline - quad[5]!) > height * 0.3 || Math.abs(g.height - height) > height * 0.5) return false;
    const center = (g.rect[0] + g.rect[2]) / 2;
    return side === "start" ? center < x0 && g.rect[2] > x0 - tolerance : center > x1 && g.rect[0] < x1 + tolerance;
  });
}

export function containsWord(text: string, target: string) {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const before = wordCharacter.test(Array.from(target)[0] ?? "") ? "(?<![\\p{L}\\p{N}])" : "";
  const after = wordCharacter.test(Array.from(target).at(-1) ?? "") ? "(?![\\p{L}\\p{N}])" : "";
  return new RegExp(before + escaped + after, "u").test(text);
}

function wholeWordHits(page: PdfPage, target: string, letters: Glyph[] | null): number[][][] {
  const hits = page.search(target, "");
  if (!hits.length) return hits;
  const found = letters ?? glyphs(page);
  const chars = Array.from(target.trim());
  const checkStart = wordCharacter.test(chars[0] ?? "");
  const checkEnd = wordCharacter.test(chars[chars.length - 1] ?? "");
  return hits.filter((hit) => !(checkStart && glued(found, hit[0]!, "start")) && !(checkEnd && glued(found, hit[hit.length - 1]!, "end")));
}

function onNextLine(head: number[][], tail: number[][]): boolean {
  const last = head[head.length - 1]!;
  const height = last[5]! - last[1]!;
  const top = tail[0]![1]!;
  return top > last[5]! - height * 0.3 && top < last[5]! + height * 2;
}

export function searchWords(page: PdfPage, target: string): number[][][] {
  const hits = wholeWordHits(page, target, null);
  if (!target.includes("-")) return hits;
  const letters = glyphs(page);
  const broken: number[][][] = [];
  for (const match of target.matchAll(/-/g)) {
    const head = target.slice(0, match.index);
    const tail = target.slice(match.index + 1);
    if (!head.trim() || !tail.trim()) continue;
    const heads = wholeWordHits(page, head, letters).filter((h) => !hits.some((hit) => hit[0]![0] === h[0]![0] && hit[0]![1] === h[0]![1]));
    if (!heads.length) continue;
    const tails = wholeWordHits(page, tail, letters);
    for (const h of heads) {
      const t = tails.find((candidate) => onNextLine(h, candidate));
      if (t) broken.push(h, t);
    }
  }
  return [...hits, ...broken];
}

const removalInset = 0.4;
const coverInset = 0.2;

export function redactionRect(quad: number[], margin: number, inset: number): Rect {
  const [ulx, uly, urx, ury, llx, lly, lrx, lry] = quad as [number, number, number, number, number, number, number, number];
  const length = Math.hypot(lrx - llx, lry - lly) || 1;
  const dx = ((lrx - llx) / length) * margin;
  const dy = ((lry - lly) / length) * margin;
  const toward = (from: number, to: number) => from + (to - from) * inset;
  const xs = [toward(ulx, llx) - dx, toward(urx, lrx) + dx, toward(llx, ulx) - dx, toward(lrx, urx) + dx];
  const ys = [toward(uly, lly) - dy, toward(ury, lry) + dy, toward(lly, uly) - dy, toward(lry, ury) + dy];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const wide = (s: string) => Array.from(s).map((c) => "\u0000" + c).join("");

const oddCharacters = /[\ufffd\u0000-\u0008\u000e-\u001f\ue000-\uf8ff]/g;

export function createPdfEngine(mupdf: MupdfModule) {
  const open = (bytes: Uint8Array): PdfDocument => {
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    if (!(doc instanceof mupdf.PDFDocument)) throw new Error("Ce fichier n'est pas un PDF.");
    return doc;
  };

  let viewed: { bytes: Uint8Array; doc: PdfDocument } | null = null;
  const view = (bytes: Uint8Array): PdfDocument => {
    if (viewed?.bytes === bytes) return viewed.doc;
    viewed?.doc.destroy();
    viewed = { bytes, doc: open(bytes) };
    return viewed.doc;
  };

  const redactQuads = (page: PdfPage, quads: number[][], margin: number) => {
    for (const quad of quads) page.createAnnotation("Redact").setRect(redactionRect(quad, margin, removalInset));
    page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
    for (const quad of quads) page.createAnnotation("Redact").setRect(redactionRect(quad, margin, coverInset));
    page.applyRedactions(true, mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_NONE);
  };

  const invisible = (image: InstanceType<MupdfModule["Image"]>) => {
    const mask = image.getMask();
    if (!mask) return false;
    const pixmap = mask.toPixmap();
    const opaque = pixmap.getPixels().some((value) => value > 0);
    pixmap.destroy();
    return !opaque;
  };

  const pageText = (page: PdfPage) => page.toStructuredText("preserve-whitespace").asText();

  const imageRects = (page: PdfPage): Rect[] => {
    const rects: Rect[] = [];
    page.toStructuredText("preserve-images").walk({ onImageBlock: (bbox, _transform, image) => { if (!invisible(image)) rects.push([...bbox] as Rect); } });
    return rects;
  };

  const coversPage = (rect: Rect, size: [number, number]) => (rect[2] - rect[0]) * (rect[3] - rect[1]) > 0.9 * size[0] * size[1];

  const looksIncoherent = (text: string) => {
    const letters = text.replace(/\s/g, "");
    if (letters.length < 40) return false;
    const odd = (letters.match(oddCharacters) ?? []).length;
    return odd / letters.length > 0.05;
  };

  const isSigned = (doc: PdfDocument) => {
    const acro = doc.getTrailer().get("Root").get("AcroForm");
    if (acro.isNull()) return false;
    const flags = acro.get("SigFlags");
    if (flags.isNumber() && (flags.asNumber() & 1) === 1) return true;
    const fields = acro.get("Fields");
    if (!fields.isArray()) return false;
    for (let i = 0; i < fields.length; i++) {
      const type = fields.get(i).get("FT");
      if (type.isName() && type.asName() === "Sig") return true;
    }
    return false;
  };

  function diagnose(bytes: Uint8Array): PdfDiagnostic {
    const doc = view(bytes);
    const result: PdfDiagnostic = { kind: "texte", pages: 0, pageSizes: [], pageTexts: [], textPages: 0, imagePages: 0, incoherent: false, warnings: [], images: [] };
    if (doc.needsPassword()) return { ...result, kind: "chiffre" };
    result.pages = doc.countPages();
    for (let i = 0; i < result.pages; i++) {
      const page = doc.loadPage(i);
      const [x0, y0, x1, y1] = page.getBounds();
      result.pageSizes.push([x1 - x0, y1 - y0]);
      const text = pageText(page);
      result.pageTexts.push(text);
      const length = text.trim().length;
      const rects = imageRects(page);
      const covered = rects.some((rect) => coversPage(rect, [x1 - x0, y1 - y0]));
      for (const rect of rects) if (!coversPage(rect, [x1 - x0, y1 - y0]) && rect[2] > rect[0] && rect[3] > rect[1]) result.images.push({ page: i, rect: [rect[0] - x0, rect[1] - y0, rect[2] - x0, rect[3] - y0] });
      const isImage = covered ? length < 400 : rects.length > 0 && length < 20;
      if (isImage) result.imagePages++;
      else if (length >= 20) result.textPages++;
      if (looksIncoherent(text)) result.incoherent = true;
      page.destroy();
    }
    result.images.sort((a, b) => a.page - b.page || a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
    if (isSigned(doc)) result.kind = "signe";
    else if (result.pages > 0 && result.imagePages === result.pages) result.kind = "scan";
    else if (result.imagePages > 0) result.kind = "mixte";
    if (doc.countLayers() > 0) result.warnings.push("Ce PDF contient des calques : il ne peut pas être traité pour l'instant.");
    if (result.incoherent) result.warnings.push("Le texte extrait paraît incohérent : la détection automatique peut manquer des éléments, relisez l'aperçu.");
    return result;
  }

  function render(bytes: Uint8Array, pageIndex: number, scale: number): { png: Uint8Array; width: number; height: number } {
    const page = view(bytes).loadPage(pageIndex);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    const rendered = { png: pixmap.asPNG().slice(), width: pixmap.getWidth(), height: pixmap.getHeight() };
    pixmap.destroy();
    page.destroy();
    return rendered;
  }

  function lines(bytes: Uint8Array, pageIndex: number): TextLine[] {
    const precision = 10;
    const page = view(bytes).loadPage(pageIndex);
    const text = page.toStructuredText("preserve-whitespace");
    const structure = JSON.parse(text.asJSON(precision)) as { blocks: { type: string; lines?: { wmode: number; bbox: { x: number; y: number; w: number; h: number }; text: string }[] }[] };
    const found: TextLine[] = [];
    for (const block of structure.blocks) {
      if (block.type !== "text") continue;
      for (const line of block.lines ?? []) {
        if (line.wmode !== 0 || !line.text.trim() || line.bbox.w <= 0 || line.bbox.h <= 0) continue;
        const { x, y, w, h } = line.bbox;
        found.push({ rect: [x / precision, y / precision, (x + w) / precision, (y + h) / precision], text: line.text });
      }
    }
    text.destroy();
    page.destroy();
    return found;
  }

  function locate(bytes: Uint8Array, values: string[]): Located[] {
    const doc = view(bytes);
    const located: Located[] = [];
    const distinct = [...new Set(values)];
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      for (const value of distinct) for (const hit of searchWords(page, value)) for (const quad of hit) located.push({ page: i, rect: quadToRect(quad), value });
      page.destroy();
    }
    return located;
  }

  function clean(bytes: Uint8Array, targets: string[], rects: Record<number, Rect[]>, rasterizePages: number[] = []): { bytes: Uint8Array; report: PdfReport } {
    const doc = open(bytes);
    if (doc.needsPassword()) throw new Error("PDF chiffré : impossible à traiter sans mot de passe.");
    if (doc.countLayers() > 0) throw new Error("PDF avec calques : non pris en charge.");
    const report: PdfReport = { pages: doc.countPages(), annotationsRemoved: 0, rootKeysRemoved: [], masked: 0, redactions: 0, rasterizedPages: [], residualPages: [] };
    const distinct = [...new Set(targets)];
    normalizeContentStreams(doc);
    for (let i = 0; i < report.pages; i++) {
      let page = doc.loadPage(i);
      for (const rect of rects[i] ?? []) {
        page.createAnnotation("Redact").setRect(rect);
        report.masked++;
      }
      if (rects[i]?.length) page.applyRedactions(true, mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
      let count = rects[i]?.length ?? 0;
      for (let pass = 0; pass < 5; pass++) {
        const quads = distinct.flatMap((target) => searchWords(page, target).flat());
        if (!quads.length) break;
        if (pass === 0) count += quads.length;
        redactQuads(page, quads, Math.min(pass, 2));
      }
      report.redactions += count;
      const remaining = distinct.flatMap((target) => searchWords(page, target)).flat().map(quadToRect);
      if (remaining.length && rasterizePages.includes(i + 1)) {
        page.destroy();
        replacePageByImage(mupdf, doc, i, remaining);
        report.rasterizedPages.push(i + 1);
        page = doc.loadPage(i);
      } else if (remaining.length) {
        report.residualPages.push(i + 1);
      }
      const pageObject = page.getObject();
      const annotations = pageObject.get("Annots");
      if (annotations.isArray()) {
        report.annotationsRemoved += annotations.length;
        pageObject.delete("Annots");
      }
      for (const key of ["AA", "PieceInfo", "Metadata", "Thumb"]) if (!pageObject.get(key).isNull()) pageObject.delete(key);
      page.destroy();
    }
    removeCaptions(doc);
    const trailer = doc.getTrailer();
    const root = trailer.get("Root");
    for (const key of rootKeysRemoved) {
      if (root.get(key).isNull()) continue;
      root.delete(key);
      report.rootKeysRemoved.push(key);
    }
    for (const key of infoKeys) doc.setMetaData("info:" + key, "");
    if (!trailer.get("Info").isNull()) trailer.delete("Info");
    const saved = doc.saveToBuffer("garbage=4,compress=yes,clean=yes,sanitize=yes");
    const cleaned = saved.asUint8Array().slice();
    saved.destroy();
    doc.destroy();
    return { bytes: cleaned, report };
  }

  function rasterize(bytes: Uint8Array, rects: Record<number, Rect[]>, scale = 2): { bytes: Uint8Array; report: PdfReport } {
    const source = open(bytes);
    const output = new mupdf.PDFDocument();
    const report: PdfReport = { pages: source.countPages(), redactions: 0, annotationsRemoved: 0, rootKeysRemoved: [], masked: 0, rasterizedPages: [], residualPages: [] };
    for (let i = 0; i < report.pages; i++) {
      const page = source.loadPage(i);
      const [x0, y0, x1, y1] = page.getBounds();
      const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
      const width = pixmap.getWidth();
      const height = pixmap.getHeight();
      const stride = pixmap.getStride();
      const components = pixmap.getNumberOfComponents();
      const pixels = pixmap.getPixels();
      for (const [rx0, ry0, rx1, ry1] of rects[i] ?? []) {
        const px0 = Math.max(0, Math.floor((rx0 - x0) * scale));
        const px1 = Math.min(width, Math.ceil((rx1 - x0) * scale));
        const py0 = Math.max(0, Math.floor((ry0 - y0) * scale));
        const py1 = Math.min(height, Math.ceil((ry1 - y0) * scale));
        for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) for (let c = 0; c < components; c++) pixels[y * stride + x * components + c] = 0;
        report.masked++;
      }
      const image = output.addImage(new mupdf.Image(pixmap));
      const resources = output.newDictionary();
      const xobjects = output.newDictionary();
      xobjects.put("Im0", image);
      resources.put("XObject", xobjects);
      const pageWidth = x1 - x0;
      const pageHeight = y1 - y0;
      output.insertPage(-1, output.addPage([0, 0, pageWidth, pageHeight], 0, resources, `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`));
      pixmap.destroy();
      page.destroy();
    }
    const saved = output.saveToBuffer("garbage=4,compress=yes");
    const rasterized = saved.asUint8Array().slice();
    saved.destroy();
    output.destroy();
    source.destroy();
    return { bytes: rasterized, report };
  }

  function verify(bytes: Uint8Array, targets: string[]): string[] {
    const findings: string[] = [];
    const doc = open(bytes);
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      const text = pageText(page);
      for (const target of targets) if (containsWord(text, target)) findings.push(`Le texte de la page ${i + 1} contient encore « ${target} ».`);
      for (const target of targets) if (searchWords(page, target).length) findings.push(`La recherche trouve encore « ${target} » page ${i + 1}.`);
      if (page.getAnnotations().length) findings.push(`Page ${i + 1} : des annotations subsistent.`);
      if (page.getWidgets().length) findings.push(`Page ${i + 1} : des champs de formulaire subsistent.`);
      page.destroy();
    }
    const root = doc.getTrailer().get("Root");
    for (const key of rootKeysChecked) if (!root.get(key).isNull()) findings.push(`La structure ${key} subsiste.`);
    for (const key of infoKeys.slice(0, 6)) if (doc.getMetaData("info:" + key)) findings.push(`La propriété ${key} subsiste.`);
    const count = doc.countObjects();
    for (let i = 1; i < count; i++) {
      let serialized = "";
      try {
        const object = doc.newIndirect(i).resolve();
        if (object.isNull()) continue;
        serialized = object.toString();
        if (object.isStream()) serialized += "\n" + latin1(object.readStream().asUint8Array());
      } catch {
        continue;
      }
      for (const target of targets) if (serialized.includes(target) || serialized.includes(wide(target))) findings.push(`Une partie interne du fichier (objet ${i}) contient encore « ${target} ».`);
    }
    doc.destroy();
    const raw = latin1(bytes);
    for (const target of targets) if (raw.includes(target) || raw.includes(wide(target))) findings.push(`Les données brutes du fichier contiennent encore « ${target} ».`);
    return [...new Set(findings)];
  }

  return { diagnose, render, lines, locate, clean, rasterize, verify };
}

type PdfObject = ReturnType<PdfDocument["getTrailer"]>;

const withoutNextLineShowOperators = (source: string) => (usesNextLineShowOperators(source) ? rewriteNextLineShowOperators(source) : null);
const withoutMarkedContentCaptions = (source: string) => (hasMarkedContentCaptions(source) ? removeMarkedContentCaptions(source) : null);

export function normalizeContentStreams(doc: PdfDocument) {
  rewriteContentStreams(doc, withoutNextLineShowOperators);
}

export function removeCaptions(doc: PdfDocument) {
  rewriteContentStreams(doc, withoutMarkedContentCaptions, (resources) => {
    const properties = resources.get("Properties");
    if (!properties.isDictionary()) return;
    properties.forEach((entry: PdfObject) => {
      if (!entry.isDictionary()) return;
      for (const key of captionKeysRemoved) if (!entry.get(key).isNull()) entry.delete(key);
    });
  });
}

function rewriteContentStreams(doc: PdfDocument, transform: (source: string) => string | null, visitProperties: (resources: PdfObject) => void = () => {}) {
  const seen = new Set<number>();
  const rewrite = (stream: PdfObject) => {
    const rewritten = transform(latin1(stream.readStream().asUint8Array()));
    if (rewritten !== null) stream.writeStream(bytesFromLatin1(rewritten));
  };
  const visitResources = (resources: PdfObject) => {
    visitProperties(resources);
    const xobjects = resources.get("XObject");
    if (!xobjects.isDictionary()) return;
    xobjects.forEach((xobject: PdfObject) => {
      if (!xobject.isStream() || !xobject.get("Subtype").isName() || xobject.get("Subtype").asName() !== "Form") return;
      const number = xobject.isIndirect() ? xobject.asIndirect() : -1;
      if (number >= 0 && seen.has(number)) return;
      if (number >= 0) seen.add(number);
      rewrite(xobject);
      const inner = xobject.get("Resources");
      if (inner.isDictionary()) visitResources(inner);
    });
  };
  for (let i = 0; i < doc.countPages(); i++) {
    const pageObject = doc.loadPage(i).getObject();
    const contents = pageObject.get("Contents");
    if (contents.isArray()) {
      const parts: string[] = [];
      for (let k = 0; k < contents.length; k++) parts.push(latin1(contents.get(k).readStream().asUint8Array()));
      const rewritten = transform(parts.join("\n"));
      if (rewritten !== null) pageObject.put("Contents", doc.addStream(bytesFromLatin1(rewritten), doc.newDictionary()));
    } else if (contents.isStream()) {
      rewrite(contents);
    }
    const resources = pageObject.getInheritable("Resources");
    if (resources.isDictionary()) visitResources(resources);
  }
}

function bytesFromLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

export function replacePageByImage(mupdf: MupdfModule, doc: PdfDocument, index: number, rects: Rect[], scale = 2) {
  const page = doc.loadPage(index);
  const [x0, y0, x1, y1] = page.getBounds();
  const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();
  const stride = pixmap.getStride();
  const components = pixmap.getNumberOfComponents();
  const pixels = pixmap.getPixels();
  for (const [rx0, ry0, rx1, ry1] of rects) {
    const px0 = Math.max(0, Math.floor((rx0 - x0) * scale));
    const px1 = Math.min(width, Math.ceil((rx1 - x0) * scale));
    const py0 = Math.max(0, Math.floor((ry0 - y0) * scale));
    const py1 = Math.min(height, Math.ceil((ry1 - y0) * scale));
    for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) for (let c = 0; c < components; c++) pixels[y * stride + x * components + c] = 0;
  }
  const image = doc.addImage(new mupdf.Image(pixmap));
  const resources = doc.newDictionary();
  const xobjects = doc.newDictionary();
  xobjects.put("Im0", image);
  resources.put("XObject", xobjects);
  const pageWidth = x1 - x0;
  const pageHeight = y1 - y0;
  doc.insertPage(index, doc.addPage([0, 0, pageWidth, pageHeight], 0, resources, `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`));
  doc.deletePage(index + 1);
}

export function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

export type PdfEngine = ReturnType<typeof createPdfEngine>;
