import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { latin1 } from "./pdf";
import { withoutOverlaps } from "./text";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const textParts = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const coreBlank = ["dc:creator", "cp:lastModifiedBy", "dc:title", "dc:subject", "dc:description", "cp:keywords", "cp:category"];
const appBlank = ["Company", "Manager"];

export interface DocxInspection {
  refusals: string[];
  warnings: string[];
  text: string;
  layout: DocxLayout;
  images: DocxImage[];
}

export interface DocxImage {
  key: string;
  part: string;
  media: string;
  bytes: number;
}

export interface DocxRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string | null;
  size: number | null;
  highlight: string | null;
}

export interface DocxParagraph {
  kind: "paragraphe";
  start: number;
  runs: DocxRun[];
  heading: number;
  align: string | null;
  list: number | null;
  images: DocxPlacedImage[];
}

export interface DocxPlacedImage {
  key: string;
  width: number;
  height: number;
}

export interface DocxTable {
  kind: "tableau";
  rows: DocxBlock[][][];
}

export type DocxBlock = DocxParagraph | DocxTable;

export interface DocxLayout {
  body: DocxBlock[];
  headers: DocxBlock[];
  footers: DocxBlock[];
  notes: DocxBlock[];
}

export interface Replacement {
  find: string;
  label: string;
}

export interface DocxReport {
  counts: Record<string, number>;
  propertiesBlanked: string[];
  warnings: string[];
  imagesRemoved: number;
}

interface Segment {
  node: Element;
  start: number;
  text: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordPattern = (s: string, flags: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(s)}(?![\\p{L}\\p{N}])`, flags);

function setText(node: Element, text: string) {
  while (node.firstChild) node.removeChild(node.firstChild);
  node.appendChild(node.ownerDocument!.createTextNode(text));
  if (/^\s|\s$/.test(text) || text === "") node.setAttribute("xml:space", "preserve");
}

function clearText(node: Element) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function nearestParagraph(node: Node): Node | null {
  let current = node.parentNode as Element | null;
  while (current && !(current.namespaceURI === W && current.localName === "p")) current = current.parentNode as Element | null;
  return current;
}

const runBreaks: Record<string, string> = { tab: "\t", br: "\n", cr: "\n" };

function ownTextNodes(paragraph: Element): Element[] {
  return (Array.from(paragraph.getElementsByTagNameNS(W, "*")) as unknown as Element[]).filter((node) =>
    (node.localName === "t" || (node.localName! in runBreaks && (node.parentNode as Element | null)?.localName === "r")) && nearestParagraph(node) === paragraph);
}

function nodeText(node: Element): string {
  return node.localName === "t" ? node.textContent ?? "" : runBreaks[node.localName!]!;
}

function replaceInParagraph(paragraph: Element, replacements: Replacement[], counts: Record<string, number>) {
  const segments: Segment[] = [];
  let full = "";
  for (const node of ownTextNodes(paragraph)) {
    const text = nodeText(node);
    segments.push({ node, start: full.length, text });
    full += text;
  }
  if (!segments.length) return;
  const matches: { start: number; end: number; label: string; find: string }[] = [];
  for (const { find, label } of replacements) for (const match of full.matchAll(wordPattern(find, "gu"))) matches.push({ start: match.index, end: match.index + match[0].length, label, find });
  for (const match of withoutOverlaps(matches).reverse()) {
    const first = segments.findIndex((s) => match.start >= s.start && match.start < s.start + s.text.length);
    if (first < 0) continue;
    let last = first;
    while (last + 1 < segments.length && segments[last]!.start + segments[last]!.text.length < match.end) last++;
    for (let i = first; i <= last; i++) {
      const segment = segments[i]!;
      const prefix = i === first ? segment.text.slice(0, match.start - segment.start) : "";
      const suffix = i === last ? segment.text.slice(match.end - segment.start) : "";
      segment.text = prefix + (i === first ? labelOpen + match.label + labelClose : "") + suffix;
    }
    counts[match.find] = (counts[match.find] ?? 0) + 1;
  }
  for (const segment of segments) {
    if (segment.node.localName !== "t") {
      if (segment.text === nodeText(segment.node)) continue;
      const t = segment.node.ownerDocument!.createElementNS(W, "w:t");
      segment.node.parentNode!.insertBefore(t, segment.node);
      segment.node.parentNode!.removeChild(segment.node);
      segment.node = t;
      if (!segment.text) {
        t.parentNode!.removeChild(t);
        continue;
      }
    }
    if (segment.text.includes(labelOpen)) splitLabels(segment.node, segment.text);
    else if ((segment.node.textContent ?? "") !== segment.text) setText(segment.node, segment.text);
  }
}

const labelOpen = "\u0001";
const labelClose = "\u0002";
const runPropertyOrder = ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"];

function setRunProperty(properties: Element, name: string, attributes: Record<string, string>) {
  const existing = child(properties, name);
  if (existing) properties.removeChild(existing);
  const element = properties.ownerDocument!.createElementNS(W, `w:${name}`);
  for (const [key, val] of Object.entries(attributes)) element.setAttributeNS(W, `w:${key}`, val);
  const rank = runPropertyOrder.indexOf(name);
  const after = children(properties).find((node) => node.namespaceURI === W && runPropertyOrder.indexOf(node.localName!) > rank);
  properties.insertBefore(element, after ?? null);
}

function labelProperties(run: Element): Element {
  const source = child(run, "rPr");
  const properties = source ? source.cloneNode(true) as Element : run.ownerDocument!.createElementNS(W, "w:rPr");
  for (const element of children(properties)) if (/^(highlight|vanish|specVanish)/.test(element.localName ?? "")) properties.removeChild(element);
  setRunProperty(properties, "color", { val: "FFFFFF" });
  setRunProperty(properties, "shd", { val: "clear", color: "auto", fill: "000000" });
  return properties;
}

function splitLabels(node: Element, text: string) {
  const run = node.parentNode as Element | null;
  if (!run || run.namespaceURI !== W || run.localName !== "r") {
    setText(node, text.replace(/[\u0001\u0002]/g, ""));
    return;
  }
  const pieces = text.split(/(\u0001[^\u0002]*\u0002)/).filter((piece) => piece !== "");
  const trailing: Node[] = [];
  for (let next = node.nextSibling; next; next = next.nextSibling) trailing.push(next);
  const plainProperties = child(run, "rPr");
  const document = run.ownerDocument!;
  let current = run;
  pieces.forEach((piece, index) => {
    const isLabel = piece.startsWith(labelOpen);
    const content = isLabel ? piece.slice(1, -1) : piece;
    if (index === 0 && !isLabel) {
      setText(node, content);
      return;
    }
    const created = document.createElementNS(W, "w:r");
    const properties = isLabel ? labelProperties(run) : plainProperties?.cloneNode(true);
    if (properties) created.appendChild(properties);
    const t = document.createElementNS(W, "w:t");
    created.appendChild(t);
    setText(t, content);
    current.parentNode!.insertBefore(created, current.nextSibling);
    current = created;
  });
  if (pieces[0]!.startsWith(labelOpen)) run.removeChild(node);
  if (trailing.length && pieces[pieces.length - 1]!.startsWith(labelOpen)) {
    const rest = document.createElementNS(W, "w:r");
    if (plainProperties) rest.appendChild(plainProperties.cloneNode(true));
    current.parentNode!.insertBefore(rest, current.nextSibling);
    current = rest;
  }
  if (current !== run) for (const moved of trailing) current.appendChild(moved);
  if (!Array.from(run.childNodes).some((n) => n.nodeType === 1 && (n as Element).localName !== "rPr")) run.parentNode?.removeChild(run);
}

function child(element: Element, name: string): Element | null {
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === W && (node as Element).localName === name) return node as Element;
  }
  return null;
}

function children(element: Element): Element[] {
  const found: Element[] = [];
  for (let node = element.firstChild; node; node = node.nextSibling) if (node.nodeType === 1) found.push(node as Element);
  return found;
}

function value(element: Element | null): string | null {
  return element ? element.getAttributeNS(W, "val") || element.getAttribute("w:val") : null;
}

function isOn(element: Element | null): boolean {
  if (!element) return false;
  const flag = value(element);
  return flag !== "0" && flag !== "false" && flag !== "none";
}

type RunStyle = Partial<Omit<DocxRun, "text">>;

interface ParagraphStyle {
  name: string;
  basedOn: string | null;
  run: RunStyle;
  numbering: { id: string; level: number } | null;
  outline: number | null;
  align: string | null;
}

interface Styles {
  paragraphs: Map<string, ParagraphStyle>;
  characters: Map<string, RunStyle>;
  bullets: Set<string>;
}

function runStyleOf(properties: Element | null): RunStyle {
  if (!properties) return {};
  const style: RunStyle = {};
  for (const [name, key] of [["b", "bold"], ["i", "italic"], ["u", "underline"], ["strike", "strike"]] as const) {
    const flag = child(properties, name);
    if (flag) style[key] = isOn(flag);
  }
  const color = value(child(properties, "color"));
  if (color && /^[0-9a-fA-F]{6}$/.test(color)) style.color = color;
  const size = Number(value(child(properties, "sz")));
  if (Number.isFinite(size) && size > 0) style.size = size / 2;
  const highlight = value(child(properties, "highlight"));
  if (highlight) style.highlight = highlight;
  return style;
}

function numberingOf(properties: Element | null): { id: string; level: number } | null {
  const numbering = properties ? child(properties, "numPr") : null;
  if (!numbering) return null;
  return { id: value(child(numbering, "numId")) ?? "", level: Number(value(child(numbering, "ilvl")) ?? 0) || 0 };
}

function resolvedParagraphStyle(styles: Styles, id: string | null, depth = 0): ParagraphStyle | null {
  const style = id ? styles.paragraphs.get(id) : undefined;
  if (!style) return null;
  const parent = depth < 10 ? resolvedParagraphStyle(styles, style.basedOn, depth + 1) : null;
  if (!parent) return style;
  return {
    name: style.name,
    basedOn: style.basedOn,
    run: { ...parent.run, ...style.run },
    numbering: style.numbering ? { id: style.numbering.id || parent.numbering?.id || "", level: style.numbering.level } : parent.numbering,
    outline: style.outline ?? parent.outline,
    align: style.align ?? parent.align,
  };
}

function runOf(text: Element, base: RunStyle, styles: Styles): DocxRun {
  const run = text.parentNode as Element | null;
  const properties = run && run.localName === "r" ? child(run, "rPr") : null;
  const character = properties ? styles.characters.get(value(child(properties, "rStyle")) ?? "") ?? {} : {};
  const style = { ...base, ...character, ...runStyleOf(properties) };
  return {
    text: nodeText(text),
    bold: style.bold ?? false,
    italic: style.italic ?? false,
    underline: style.underline ?? false,
    strike: style.strike ?? false,
    color: style.color ?? null,
    size: style.size ?? null,
    highlight: style.highlight && style.highlight !== "none" ? style.highlight : null,
  };
}

function headingLevel(style: ParagraphStyle | null): number {
  if (!style) return 0;
  const name = style.name.toLowerCase();
  if (/^(title|titre)$/.test(name)) return 1;
  const level = /^(?:heading|titre)\s*(\d)$/.exec(name);
  if (level) return Math.min(6, Number(level[1]) + 1);
  return style.outline === null ? 0 : Math.min(6, style.outline + 2);
}

const pixelsPerEmu = 96 / 914400;

function placedImages(element: Element, part: string): DocxPlacedImage[] {
  const placed: DocxPlacedImage[] = [];
  for (const blip of Array.from(element.getElementsByTagNameNS(A, "blip")) as unknown as Element[]) {
    const id = blip.getAttributeNS(R, "embed") || blip.getAttribute("r:embed");
    if (!id) continue;
    let holder: Element | null = blip;
    while (holder && !(holder.localName === "inline" || holder.localName === "anchor")) holder = holder.parentNode as Element | null;
    const extent = holder ? Array.from(holder.childNodes).find((node) => node.nodeType === 1 && (node as Element).localName === "extent") as Element | undefined : undefined;
    const width = Number(extent?.getAttribute("cx") ?? 0) * pixelsPerEmu;
    const height = Number(extent?.getAttribute("cy") ?? 0) * pixelsPerEmu;
    placed.push({ key: `${part}#${id}`, width: Math.round(width), height: Math.round(height) });
  }
  return placed;
}

function embeddedImages(element: Element, part: string): string[] {
  return placedImages(element, part).map((image) => image.key);
}

function layoutOf(container: Element, starts: Map<Element, number>, styles: Styles, part = ""): DocxBlock[] {
  const blocks: DocxBlock[] = [];
  for (const element of children(container)) {
    if (element.namespaceURI !== W) continue;
    if (element.localName === "p") {
      const start = starts.get(element);
      if (start === undefined) continue;
      const properties = child(element, "pPr");
      const style = resolvedParagraphStyle(styles, properties ? value(child(properties, "pStyle")) : null);
      const numbering = numberingOf(properties) ?? style?.numbering ?? null;
      blocks.push({
        kind: "paragraphe",
        start,
        runs: ownTextNodes(element).map((text) => runOf(text, style?.run ?? {}, styles)),
        heading: headingLevel(style),
        align: (properties ? value(child(properties, "jc")) : null) ?? style?.align ?? null,
        list: numbering && styles.bullets.has(`${numbering.id}:${numbering.level}`) ? numbering.level : null,
        images: placedImages(element, part),
      });
    } else if (element.localName === "tbl") {
      blocks.push({
        kind: "tableau",
        rows: children(element).filter((row) => row.localName === "tr").map((row) =>
          children(row).filter((cell) => cell.localName === "tc").map((cell) => layoutOf(cell, starts, styles, part))),
      });
    } else if (["sdt", "sdtContent", "customXml", "body", "footnote", "endnote"].includes(element.localName)) {
      blocks.push(...layoutOf(element.localName === "sdt" ? child(element, "sdtContent") ?? element : element, starts, styles, part));
    }
  }
  return blocks;
}

async function xmlOf(zip: JSZip, parser: DOMParser, name: string): Promise<Element | null> {
  const file = zip.file(name);
  return file ? parser.parseFromString(await file.async("string"), "text/xml").documentElement as unknown as Element : null;
}

async function stylesOf(zip: JSZip, parser: DOMParser): Promise<Styles> {
  const styles: Styles = { paragraphs: new Map(), characters: new Map(), bullets: new Set() };
  const definitions = await xmlOf(zip, parser, "word/styles.xml");
  const defaults = definitions ? child(definitions, "docDefaults") : null;
  const defaultRun = defaults ? child(child(defaults, "rPrDefault") ?? defaults, "rPr") : null;
  const baseRun = runStyleOf(defaultRun);
  for (const style of definitions ? children(definitions).filter((element) => element.localName === "style") : []) {
    const id = style.getAttributeNS(W, "styleId") || style.getAttribute("w:styleId");
    const type = style.getAttributeNS(W, "type") || style.getAttribute("w:type");
    if (!id) continue;
    const run = runStyleOf(child(style, "rPr"));
    if (type === "character") {
      styles.characters.set(id, run);
      continue;
    }
    if (type !== "paragraph") continue;
    const paragraph = child(style, "pPr");
    const outline = paragraph ? value(child(paragraph, "outlineLvl")) : null;
    const basedOn = value(child(style, "basedOn"));
    styles.paragraphs.set(id, {
      name: value(child(style, "name")) ?? id,
      basedOn,
      run: basedOn ? run : { ...baseRun, ...run },
      numbering: numberingOf(paragraph),
      outline: outline === null ? null : Number(outline),
      align: paragraph ? value(child(paragraph, "jc")) : null,
    });
  }
  const numbering = await xmlOf(zip, parser, "word/numbering.xml");
  if (numbering) {
    const abstractBullets = new Map<string, Set<number>>();
    for (const abstract of children(numbering).filter((element) => element.localName === "abstractNum")) {
      const levels = new Set<number>();
      for (const level of children(abstract).filter((element) => element.localName === "lvl")) {
        if (value(child(level, "numFmt")) === "bullet") levels.add(Number(level.getAttributeNS(W, "ilvl") || level.getAttribute("w:ilvl") || 0));
      }
      abstractBullets.set(abstract.getAttributeNS(W, "abstractNumId") || abstract.getAttribute("w:abstractNumId") || "", levels);
    }
    for (const instance of children(numbering).filter((element) => element.localName === "num")) {
      const id = instance.getAttributeNS(W, "numId") || instance.getAttribute("w:numId") || "";
      for (const level of abstractBullets.get(value(child(instance, "abstractNumId")) ?? "") ?? []) styles.bullets.add(`${id}:${level}`);
    }
  }
  return styles;
}

export async function inspectDocx(bytes: Uint8Array): Promise<DocxInspection> {
  const zip = await JSZip.loadAsync(bytes);
  if (!zip.file("word/document.xml")) throw new Error("Ce fichier n'est pas un document Word.");
  const refusals = new Set<string>();
  const warnings = new Set<string>();
  const names = Object.keys(zip.files);
  if (names.some((n) => /^word\/embeddings\//.test(n))) refusals.add("objets incorporés");
  if (names.some((n) => /vbaProject\.bin$/.test(n))) refusals.add("macros");
  const parser = new DOMParser();
  const styles = await stylesOf(zip, parser);
  const texts: string[] = [];
  const layout: DocxLayout = { body: [], headers: [], footers: [], notes: [] };
  const images: DocxImage[] = [];
  let offset = 0;
  for (const name of names) {
    if (!/^word\/.*\.xml$/.test(name)) continue;
    const xml = await zip.file(name)!.async("string");
    if (/<w:(ins|del|moveFrom|moveTo|rPrChange|pPrChange|tblPrChange|trPrChange|tcPrChange|sectPrChange)\b/.test(xml)) refusals.add("révisions non acceptées");
    if (/<w:comment(RangeStart|Reference)\b/.test(xml) || (/^word\/comments/.test(name) && /<w:comment\b/.test(xml))) refusals.add("commentaires");
    if (/<(w:object|o:OLEObject)\b/.test(xml)) refusals.add("objets incorporés");
    if (!textParts.test(name)) continue;
    const dom = parser.parseFromString(xml, "text/xml");
    const starts = new Map<Element, number>();
    for (const paragraph of Array.from(dom.getElementsByTagNameNS(W, "p")) as unknown as Element[]) {
      const text = ownTextNodes(paragraph).map(nodeText).join("");
      starts.set(paragraph, offset);
      texts.push(text);
      offset += text.length + 1;
    }
    const root = dom.documentElement as unknown as Element;
    const part = /^word\/document/.test(name) ? "body" : /^word\/header/.test(name) ? "headers" : /^word\/footer/.test(name) ? "footers" : "notes";
    const container = part === "body" ? child(root, "body") ?? root : root;
    layout[part].push(...layoutOf(container, starts, styles, name));
    images.push(...await imagesOf(zip, parser, name, root));
  }
  const order = (image: DocxImage) => /header/.test(image.part) ? 0 : /document/.test(image.part) ? 1 : /footer/.test(image.part) ? 2 : 3;
  images.sort((a, b) => order(a) - order(b));
  return { refusals: [...refusals], warnings: [...warnings], text: texts.join("\n"), layout, images };
}

function relationshipsName(part: string): string {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`;
}

async function relationshipTargets(zip: JSZip, parser: DOMParser, part: string): Promise<Map<string, string>> {
  const targets = new Map<string, string>();
  const root = await xmlOf(zip, parser, relationshipsName(part));
  if (!root) return targets;
  for (const relationship of Array.from(root.getElementsByTagNameNS(PKG, "Relationship")) as unknown as Element[]) {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `word/${target}`);
  }
  return targets;
}

async function imagesOf(zip: JSZip, parser: DOMParser, part: string, root: Element): Promise<DocxImage[]> {
  const targets = await relationshipTargets(zip, parser, part);
  const seen = new Set<string>();
  const images: DocxImage[] = [];
  for (const key of embeddedImages(root, part)) {
    if (seen.has(key)) continue;
    seen.add(key);
    const media = targets.get(key.slice(part.length + 1));
    const file = media ? zip.file(media) : null;
    if (!media || !file) continue;
    images.push({ key, part, media, bytes: (await file.async("uint8array")).length });
  }
  return images;
}

export async function imageBytes(bytes: Uint8Array, key: string): Promise<{ bytes: Uint8Array; media: string } | null> {
  const zip = await JSZip.loadAsync(bytes);
  const parser = new DOMParser();
  const part = key.slice(0, key.indexOf("#"));
  const media = (await relationshipTargets(zip, parser, part)).get(key.slice(part.length + 1));
  const file = media ? zip.file(media) : null;
  return media && file ? { bytes: await file.async("uint8array"), media } : null;
}

function removeDrawings(dom: Element, part: string, removed: Set<string>): number {
  let count = 0;
  for (const blip of Array.from(dom.getElementsByTagNameNS(A, "blip")) as unknown as Element[]) {
    const id = blip.getAttributeNS(R, "embed") || blip.getAttribute("r:embed");
    if (!id || !removed.has(`${part}#${id}`)) continue;
    let holder: Element | null = blip;
    while (holder && !(holder.namespaceURI === W && (holder.localName === "drawing" || holder.localName === "pict"))) holder = holder.parentNode as Element | null;
    const target = holder ?? blip;
    const run = target.parentNode as Element | null;
    target.parentNode?.removeChild(target);
    if (run && run.namespaceURI === W && run.localName === "r" && !Array.from(run.childNodes).some((node) => node.nodeType === 1 && (node as Element).localName !== "rPr")) run.parentNode?.removeChild(run);
    count++;
  }
  return count;
}

function blankImageCaptions(dom: Element): void {
  for (const element of Array.from(dom.getElementsByTagName("*")) as unknown as Element[]) {
    if (element.localName !== "docPr" && element.localName !== "cNvPr") continue;
    for (const attribute of ["descr", "title"]) if (element.getAttribute(attribute)) element.setAttribute(attribute, "");
    if (element.getAttribute("name")) element.setAttribute("name", "Image");
  }
}

async function dropUnreferencedMedia(zip: JSZip, parser: DOMParser, serializer: XMLSerializer, part: string, xml: string): Promise<void> {
  const relationshipsPart = relationshipsName(part);
  const root = await xmlOf(zip, parser, relationshipsPart);
  if (!root) return;
  for (const relationship of Array.from(root.getElementsByTagNameNS(PKG, "Relationship")) as unknown as Element[]) {
    const id = relationship.getAttribute("Id");
    const type = relationship.getAttribute("Type") ?? "";
    const target = relationship.getAttribute("Target") ?? "";
    if (!id || !/\/image$/.test(type) || xml.includes(`r:embed="${id}"`) || xml.includes(`r:id="${id}"`)) continue;
    relationship.parentNode?.removeChild(relationship);
    const media = target.startsWith("/") ? target.slice(1) : `word/${target}`;
    const others = await Promise.all(Object.keys(zip.files).filter((name) => /_rels\/.*\.rels$/.test(name) && name !== relationshipsPart).map((name) => zip.file(name)!.async("string")));
    if (!others.some((content) => content.includes(target))) zip.remove(media);
  }
  zip.file(relationshipsPart, serializer.serializeToString(root.ownerDocument as unknown as Parameters<XMLSerializer["serializeToString"]>[0]));
}

async function dropThumbnail(zip: JSZip, parser: DOMParser, serializer: XMLSerializer): Promise<void> {
  const names = Object.keys(zip.files).filter((name) => /^docProps\/thumbnail\./.test(name));
  if (!names.length) return;
  for (const name of names) zip.remove(name);
  const root = await xmlOf(zip, parser, "_rels/.rels");
  if (root) {
    for (const relationship of Array.from(root.getElementsByTagNameNS(PKG, "Relationship")) as unknown as Element[]) {
      if (/\/thumbnail$/.test(relationship.getAttribute("Type") ?? "")) relationship.parentNode?.removeChild(relationship);
    }
    zip.file("_rels/.rels", serializer.serializeToString(root.ownerDocument as unknown as Parameters<XMLSerializer["serializeToString"]>[0]));
  }
  const types = zip.file("[Content_Types].xml");
  if (types) zip.file("[Content_Types].xml", (await types.async("string")).replace(/<Override[^>]*PartName="\/docProps\/thumbnail\.[^"]*"[^>]*\/>/g, ""));
}

export async function cleanDocx(bytes: Uint8Array, replacements: Replacement[], removedImages: string[] = []): Promise<{ bytes: Uint8Array; report: DocxReport }> {
  const inspection = await inspectDocx(bytes);
  if (inspection.refusals.length) throw new Error(`Document refusé : ${inspection.refusals.join(", ")}.`);
  const zip = await JSZip.loadAsync(bytes);
  const report: DocxReport = { counts: {}, propertiesBlanked: [], warnings: inspection.warnings, imagesRemoved: 0 };
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const removed = new Set(removedImages);
  for (const name of Object.keys(zip.files)) {
    if (!textParts.test(name)) continue;
    const dom = parser.parseFromString(await zip.file(name)!.async("string"), "text/xml");
    for (const paragraph of Array.from(dom.getElementsByTagNameNS(W, "p"))) replaceInParagraph(paragraph as unknown as Element, replacements, report.counts);
    const root = dom.documentElement as unknown as Element;
    report.imagesRemoved += removeDrawings(root, name, removed);
    blankImageCaptions(root);
    const xml = serializer.serializeToString(dom);
    zip.file(name, xml);
    await dropUnreferencedMedia(zip, parser, serializer, name, xml);
  }
  await dropThumbnail(zip, parser, serializer);
  for (const [part, tags] of [["docProps/core.xml", coreBlank], ["docProps/app.xml", appBlank]] as const) {
    const file = zip.file(part);
    if (!file) continue;
    const dom = parser.parseFromString(await file.async("string"), "text/xml");
    for (const tag of tags) {
      for (const element of Array.from(dom.getElementsByTagName(tag))) {
        if (!element.textContent) continue;
        clearText(element as unknown as Element);
        report.propertiesBlanked.push(tag);
      }
    }
    zip.file(part, serializer.serializeToString(dom));
  }
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), report };
}

export async function verifyDocx(bytes: Uint8Array, targets: string[]): Promise<string[]> {
  const findings: string[] = [];
  const zip = await JSZip.loadAsync(bytes);
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name]!.dir) continue;
    const isText = /\.(xml|rels|txt)$/.test(name);
    const content = isText ? unescapeXml(await zip.file(name)!.async("string")) : latin1(await zip.file(name)!.async("uint8array"));
    for (const target of targets) if (wordPattern(target, "u").test(content)) findings.push(`La partie ${name} contient encore « ${target} ».`);
  }
  return findings;
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (_, entity: string) => entities[entity] ?? String.fromCodePoint(entity[1] === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)));
}
