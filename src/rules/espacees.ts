import type { Finding } from "./types";

const run = /(?<![\p{L}\p{N}])\p{L}{1,2}(?: \p{L}{1,2})+(?![\p{L}\p{N}])/gu;
const lower = /\p{Ll}/u;
const upper = /\p{Lu}/u;
const hyphenBreak = /-\n(?=\p{Lu})/gu;
const lineBreak = /[ \u00a0]*\n[ \u00a0]*/g;

interface Token {
  text: string;
  start: number;
}

function spacedTokens(match: string, offset: number): Token[] | null {
  const tokens: Token[] = [];
  let start = offset;
  for (const text of match.split(" ")) {
    tokens.push({ text, start });
    start += text.length + 1;
  }
  while (tokens.length && tokens[0]!.text.length > 1) tokens.shift();
  while (tokens.length && tokens[tokens.length - 1]!.text.length > 1) tokens.pop();
  const singles = tokens.filter((token) => token.text.length === 1).length;
  return tokens.length >= 4 && singles >= 0.75 * tokens.length ? tokens : null;
}

interface Cut {
  start: number;
  end: number;
  keep?: string;
}

function cuts(text: string): Cut[] {
  const found: Cut[] = [];
  for (const match of text.matchAll(run)) {
    const tokens = spacedTokens(match[0], match.index);
    if (!tokens) continue;
    tokens.forEach((token, k) => {
      const previous = tokens[k - 1];
      if (!previous) return;
      const keep = lower.test(previous.text.at(-1)!) && upper.test(token.text[0]!) ? " " : undefined;
      found.push({ start: token.start - 1, end: token.start, keep });
    });
  }
  for (const match of text.matchAll(hyphenBreak)) found.push({ start: match.index + 1, end: match.index + 2 });
  return found.sort((a, b) => a.start - b.start);
}

export function regroup(text: string): { text: string; origin: number[] } {
  let output = "";
  const origin: number[] = [];
  let cursor = 0;
  const copy = (from: number, to: number) => {
    for (let i = from; i < to; i++) origin.push(i);
    output += text.slice(from, to);
  };
  for (const cut of cuts(text)) {
    copy(cursor, cut.start);
    if (cut.keep) {
      origin.push(cut.start);
      output += cut.keep;
    }
    cursor = cut.end;
  }
  copy(cursor, text.length);
  return { text: output, origin };
}

export function restore(text: string, origin: number[], finding: Finding): Finding {
  const start = origin[finding.start]!;
  const end = origin[finding.end - 1]! + 1;
  return { ...finding, value: text.slice(start, end).replace(hyphenBreak, "-").replace(lineBreak, " "), start, end };
}
