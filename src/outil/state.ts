import type { Category, Finding, Origin } from "../rules";
import { detect, isPreselected } from "../rules";
import type { DocxInspection } from "../engine/docx";
import type { TextEncoding, TextExtension } from "./fichiers-texte";
import { createLabeler } from "../engine/labels";
import type { Located, PdfDiagnostic, Rect, TextLine } from "../engine/types";
import { doubtFindings, type ReadPage } from "./texte-lu";

export type Step = "depot" | "relecture" | "resultat";

export interface Source {
  format: "pdf" | "docx" | "texte";
  textExtension?: TextExtension;
  textEncoding?: TextEncoding;
  name: string;
  bytes: Uint8Array | null;
  text: string;
  diagnostic: PdfDiagnostic | null;
  inspection: DocxInspection | null;
  read?: ReadPage[];
}

export interface Item {
  key: string;
  category: Category;
  value: string;
  origin: Origin;
  occurrences: Finding[];
}

export interface Snapshot {
  selected: string[];
  decided: string[];
  zones: Record<number, Rect[]>;
  words: string[];
  dismissed: string[];
  removedImages: string[];
}

export interface ExportResult {
  bytes: Uint8Array;
  fileName: string;
  mime: string;
  findings: string[];
  summary: string[];
  compteRendu: string;
  residualPages: number[];
  removed: number;
  occurrences: number;
  zones: number;
  images: number;
  text: string | null;
  pagesRead: number;
}

export interface Reading {
  done: number;
  total: number;
  started: number;
}

export interface State {
  step: Step;
  source: Source | null;
  words: string[];
  items: Item[];
  selected: Set<string>;
  decided: Set<string>;
  zones: Record<number, Rect[]>;
  located: Located[];
  pages: { url: string; width: number; height: number; scale: number; lines: TextLine[] }[];
  dismissed: string[];
  removedImages: string[];
  past: Snapshot[];
  future: Snapshot[];
  result: ExportResult | null;
  reading: Reading | null;
}

export const itemKey = (category: Category, value: string) => `${category}:${value}`;

export function createState(): State {
  return { step: "depot", source: null, words: [], items: [], selected: new Set(), decided: new Set(), zones: {}, located: [], pages: [], dismissed: [], removedImages: [], past: [], future: [], result: null, reading: null };
}

export function groupFindings(findings: Finding[]): Item[] {
  const groups = new Map<string, Item>();
  for (const finding of findings) {
    const key = itemKey(finding.category, finding.value);
    const existing = groups.get(key);
    if (existing) existing.occurrences.push(finding);
    else groups.set(key, { key, category: finding.category, value: finding.value, origin: finding.origin, occurrences: [finding] });
  }
  return [...groups.values()];
}

export function analyse(state: State) {
  if (!state.source) return;
  const previous = state.items;
  const detected = detect(state.source.text, state.words, { espacees: !state.source.read });
  const findings = state.source.read ? [...detected, ...doubtFindings(state.source.read, detected)] : detected;
  state.items = groupFindings(findings).filter((item) => !state.dismissed.includes(item.key));
  const known = new Set(previous.map((item) => item.key));
  for (const item of state.items) {
    if (known.has(item.key)) continue;
    if (isPreselected(item.occurrences[0]!)) state.selected.add(item.key);
  }
  for (const key of [...state.selected]) if (!state.items.some((item) => item.key === key)) state.selected.delete(key);
}

export function addWord(state: State, word: string) {
  const trimmed = word.trim();
  if (!trimmed) return;
  state.words = [...new Set([...state.words, trimmed])];
  analyse(state);
  const wanted = trimmed.toLocaleLowerCase("fr");
  choose(state, state.items.filter((item) => item.category === "mot" && item.value.toLocaleLowerCase("fr") === wanted).map((item) => item.key), true);
}

export function removeWord(state: State, word: string) {
  const wanted = word.trim().toLocaleLowerCase("fr");
  state.words = state.words.filter((known) => known.toLocaleLowerCase("fr") !== wanted);
  analyse(state);
}

export function dismissItem(state: State, key: string) {
  state.dismissed = [...new Set([...state.dismissed, key])];
  state.selected.delete(key);
  state.decided.delete(key);
  analyse(state);
}

export function choose(state: State, keys: string[], remove: boolean) {
  const related = new Set(keys);
  const words = new Set(state.items.filter((item) => item.category === "mot" && related.has(item.key)).map((item) => item.value.toLocaleLowerCase("fr")));
  for (const item of state.items) {
    if (item.category === "mot" && words.has(item.value.toLocaleLowerCase("fr"))) related.add(item.key);
  }
  for (const key of related) {
    state.decided.add(key);
    if (remove) state.selected.add(key);
    else state.selected.delete(key);
  }
}

export function snapshot(state: State): Snapshot {
  return { selected: [...state.selected], decided: [...state.decided], zones: structuredClone(state.zones), words: [...state.words], dismissed: [...state.dismissed], removedImages: [...state.removedImages] };
}

export function restore(state: State, saved: Snapshot) {
  state.selected = new Set(saved.selected);
  state.decided = new Set(saved.decided);
  state.zones = structuredClone(saved.zones);
  const changed = saved.words.join("\n") !== state.words.join("\n") || saved.dismissed.join("\n") !== state.dismissed.join("\n");
  state.words = [...saved.words];
  state.dismissed = [...saved.dismissed];
  state.removedImages = [...saved.removedImages];
  if (changed) analyse(state);
}

export function commit(state: State, mutate: () => void) {
  state.past.push(snapshot(state));
  state.future = [];
  mutate();
}

export function undo(state: State): boolean {
  const previous = state.past.pop();
  if (!previous) return false;
  state.future.push(snapshot(state));
  restore(state, previous);
  return true;
}

export function redo(state: State): boolean {
  const next = state.future.pop();
  if (!next) return false;
  state.past.push(snapshot(state));
  restore(state, next);
  return true;
}

export function selectedItems(state: State): Item[] {
  return state.items.filter((item) => state.selected.has(item.key));
}

export function occurrenceCount(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.occurrences.length, 0);
}

export function toggleImageRemoval(state: State, key: string) {
  state.removedImages = state.removedImages.includes(key) ? state.removedImages.filter((known) => known !== key) : [...state.removedImages, key];
}

export const sameRect = (a: Rect, b: Rect): boolean => a.every((value, index) => Math.abs(value - b[index]!) < 0.01);

export function toggleImageZone(state: State, page: number, rect: Rect) {
  const zones = state.zones[page] ?? [];
  const index = zones.findIndex((zone) => sameRect(zone, rect));
  if (index >= 0) zones.splice(index, 1);
  else zones.push([...rect] as Rect);
  state.zones[page] = zones;
}

export function zoneCount(state: State): number {
  return Object.values(state.zones).reduce((sum, zones) => sum + zones.length, 0);
}

export function labelsFor(items: Item[]): Map<string, string> {
  const label = createLabeler();
  return new Map(items.map((item) => [item.key, label(item.category, item.value)]));
}

