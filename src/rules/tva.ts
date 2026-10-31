import { mod97 } from "./checksum";
import type { Finding, Rule } from "./types";

const pattern = /\bFR[ \u00a0]?([0-9A-Z]{2})[ \u00a0]?(\d{3}[ \u00a0]?\d{3}[ \u00a0]?\d{3})\b/g;

export function tvaKeyIsValid(key: string, sirenDigits: string): boolean {
  if (!/^\d{2}$/.test(key)) return true;
  return Number(key) === (12 + 3 * mod97(sirenDigits)) % 97;
}

export const tva: Rule = {
  category: "tva",
  detect(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const match of text.matchAll(pattern)) {
      const valid = tvaKeyIsValid(match[1]!, match[2]!.replace(/[ \u00a0]/g, ""));
      findings.push({ category: "tva", value: match[0], start: match.index, end: match.index + match[0].length, origin: valid ? "clé valide" : "suggestion à relire" });
    }
    return findings;
  },
};
