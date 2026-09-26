import type { Located, Rect, TextLine } from "../engine/types";
import type { Finding } from "../rules";

export interface ReadWord {
  text: string;
  confidence?: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface ReadLine {
  words: ReadWord[];
}

export interface PlacedWord {
  start: number;
  end: number;
  line: number;
  rect: Rect;
}

export interface ReadPage {
  text: string;
  words: PlacedWord[];
  lines: TextLine[];
  doubts: Doubt[];
}

export interface Doubt {
  text: string;
  start: number;
  end: number;
}

const doubtThreshold = 60;
const meaningful = /[\p{L}\p{N}]{2}/u;

const union = (rects: Rect[]): Rect => [
  Math.min(...rects.map((rect) => rect[0])),
  Math.min(...rects.map((rect) => rect[1])),
  Math.max(...rects.map((rect) => rect[2])),
  Math.max(...rects.map((rect) => rect[3])),
];

export function assemblePage(lines: ReadLine[], scale: number): ReadPage {
  const words: PlacedWord[] = [];
  const pieces: TextLine[] = [];
  const doubts: Doubt[] = [];
  let text = "";
  let lineIndex = 0;
  for (const line of lines) {
    const kept = line.words.filter((word) => word.text.trim());
    if (!kept.length) continue;
    if (text) text += "\n";
    const rects: Rect[] = kept.map((word) => [word.bbox.x0 / scale, word.bbox.y0 / scale, word.bbox.x1 / scale, word.bbox.y1 / scale]);
    kept.forEach((word, index) => {
      if (index) text += " ";
      words.push({ start: text.length, end: text.length + word.text.length, line: lineIndex, rect: rects[index]! });
      if ((word.confidence ?? 100) < doubtThreshold && meaningful.test(word.text)) doubts.push({ text: word.text, start: text.length, end: text.length + word.text.length });
      text += word.text;
    });
    pieces.push(...selectablePieces(kept, rects));
    lineIndex++;
  }
  return { text, words, lines: pieces, doubts };
}

function selectablePieces(words: ReadWord[], rects: Rect[]): TextLine[] {
  return words.map((word, index) => {
    const rect = rects[index]!;
    const next = rects[index + 1];
    if (!next) return { rect, text: word.text };
    return { rect: [rect[0], rect[1], Math.max(rect[2], next[0]), rect[3]], text: `${word.text} ` };
  });
}

export interface Spanned {
  value: string;
  occurrences: { start: number; end: number }[];
}

export function locateRead(pages: ReadPage[], items: Spanned[]): Located[] {
  const offsets = pageOffsets(pages);
  const located: Located[] = [];
  for (const item of items) {
    for (const occurrence of item.occurrences) {
      const pageIndex = pageAt(offsets, occurrence.start);
      const page = pages[pageIndex];
      if (!page) continue;
      const start = occurrence.start - offsets[pageIndex]!;
      const end = occurrence.end - offsets[pageIndex]!;
      const byLine = new Map<number, Rect[]>();
      for (const word of page.words) {
        if (word.end <= start || word.start >= end) continue;
        byLine.set(word.line, [...(byLine.get(word.line) ?? []), word.rect]);
      }
      for (const rects of byLine.values()) located.push({ page: pageIndex, rect: union(rects), value: item.value });
    }
  }
  return located;
}

function pageOffsets(pages: ReadPage[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const page of pages) {
    offsets.push(offset);
    offset += page.text.length + pageBreak.length;
  }
  return offsets;
}

function pageAt(offsets: number[], position: number): number {
  let index = 0;
  while (index + 1 < offsets.length && offsets[index + 1]! <= position) index++;
  return index;
}

export function widen(rect: Rect): Rect {
  const height = rect[3] - rect[1];
  const vertical = height * 0.2;
  const horizontal = height * 0.15;
  return [rect[0] - horizontal, rect[1] - vertical, rect[2] + horizontal, rect[3] + vertical];
}

export const pageBreak = "\n\f";

export function doubtFindings(pages: ReadPage[], found: Finding[]): Finding[] {
  const doubts: Finding[] = [];
  let offset = 0;
  for (const page of pages) {
    for (const doubt of page.doubts) {
      const start = offset + doubt.start;
      const end = offset + doubt.end;
      if (found.some((finding) => finding.start < end && start < finding.end)) continue;
      doubts.push({ category: "douteux", value: doubt.text, start, end, origin: "suggestion à relire" });
    }
    offset += page.text.length + pageBreak.length;
  }
  return doubts;
}
