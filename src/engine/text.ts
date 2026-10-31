export interface Span {
  start: number;
  end: number;
  label: string;
}

export function withoutOverlaps<T extends { start: number; end: number }>(spans: T[]): T[] {
  const longestFirst = [...spans].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: T[] = [];
  for (const span of longestFirst) {
    if (kept.some((k) => span.start < k.end && k.start < span.end)) continue;
    kept.push(span);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function replaceSpans(text: string, spans: Span[]): string {
  let output = "";
  let cursor = 0;
  for (const span of withoutOverlaps(spans)) {
    output += text.slice(cursor, span.start) + span.label;
    cursor = span.end;
  }
  return output + text.slice(cursor);
}
