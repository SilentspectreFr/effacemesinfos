import { replaceSpans, withoutOverlaps, type Span } from "../engine/text";
import type { Item } from "./state";

export type Status = "retire" | "conserve";

export interface Segment {
  start: number;
  end: number;
  key: string | null;
  status: Status | null;
  label: string;
  first: boolean;
}

interface Keyed {
  start: number;
  end: number;
  key: string;
}

export function removalSpans(items: Item[], labels: Map<string, string>): (Span & Keyed)[] {
  return withoutOverlaps(items.flatMap((item) => item.occurrences.map((occurrence) => ({ start: occurrence.start, end: occurrence.end, key: item.key, label: labels.get(item.key) ?? "" }))));
}

function outside(span: Keyed, removals: Keyed[]): Keyed[] {
  let pieces: Keyed[] = [span];
  for (const removal of removals) {
    pieces = pieces.flatMap((piece) => {
      if (removal.end <= piece.start || piece.end <= removal.start) return [piece];
      return [
        { ...piece, end: Math.min(piece.end, removal.start) },
        { ...piece, start: Math.max(piece.start, removal.end) },
      ].filter((part) => part.end > part.start);
    });
  }
  return pieces;
}

export function previewSegments(text: string, items: Item[], selected: Set<string>, labels: Map<string, string>): Segment[] {
  const removals = removalSpans(items.filter((item) => selected.has(item.key)), labels);
  const kept = items.filter((item) => !selected.has(item.key)).flatMap((item) => item.occurrences.flatMap((occurrence) =>
    outside({ start: occurrence.start, end: occurrence.end, key: item.key }, removals).map((piece, index) => ({ ...piece, first: index === 0 }))));
  const marked: Segment[] = [
    ...removals.map((removal) => ({ start: removal.start, end: removal.end, key: removal.key, status: "retire" as const, label: removal.label, first: true })),
    ...withoutOverlaps(kept).map((piece) => ({ start: piece.start, end: piece.end, key: piece.key, status: "conserve" as const, label: "", first: piece.first })),
  ].sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const segment of marked) {
    if (segment.start > cursor) segments.push({ start: cursor, end: segment.start, key: null, status: null, label: "", first: false });
    segments.push(segment);
    cursor = segment.end;
  }
  if (cursor < text.length) segments.push({ start: cursor, end: text.length, key: null, status: null, label: "", first: false });
  return segments;
}

export function resultText(text: string, segments: Segment[]): string {
  return segments.map((segment) => segment.status === "retire" ? segment.label : text.slice(segment.start, segment.end)).join("");
}

export function cleanText(text: string, items: Item[], labels: Map<string, string>): string {
  return replaceSpans(text, removalSpans(items, labels));
}
