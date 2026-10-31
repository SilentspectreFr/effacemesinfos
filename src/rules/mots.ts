import type { Finding } from "./types";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function detectWords(text: string, words: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const word of words) {
    const trimmed = word.trim();
    if (!trimmed) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(trimmed)}(?![\\p{L}\\p{N}])`, "giu");
    for (const match of text.matchAll(pattern)) findings.push({ category: "mot", value: match[0], start: match.index, end: match.index + match[0].length, origin: "mot demandé" });
  }
  return findings;
}
