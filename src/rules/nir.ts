import { mod97 } from "./checksum";
import type { Finding, Rule } from "./types";

const pattern = /(?<![\p{L}\p{N}])[12][ \u00a0]?\d{2}[ \u00a0]?(?:0[1-9]|1[0-2]|20|3\d|4[0-2]|[5-9]\d)[ \u00a0]?(?:\d{2}|2[AB])[ \u00a0]?\d{3}[ \u00a0]?\d{3}(?:[ \u00a0]?\d{2})?(?![\p{L}\p{N}])/gu;

export function nirIsValid(candidate: string): boolean {
  const compact = candidate.replace(/[ \u00a0]/g, "").toUpperCase();
  if (compact.length !== 15) return false;
  const body = compact.slice(0, 13).replace("2A", "19").replace("2B", "18");
  if (!/^\d{13}$/.test(body)) return false;
  const key = Number(compact.slice(13));
  return key === 97 - mod97(body);
}

export const nir: Rule = {
  category: "nir",
  detect(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const match of text.matchAll(pattern)) {
      const valid = nirIsValid(match[0]);
      findings.push({ category: "nir", value: match[0], start: match.index, end: match.index + match[0].length, origin: valid ? "clé valide" : "suggestion à relire" });
    }
    return findings;
  },
};
