import { mod97 } from "./checksum";
import type { Finding, Rule } from "./types";

const pattern = /(?<![A-Z0-9-])[A-Z]{2}\d{2}(?:[ \u00a0]?[A-Z0-9]{4}){2,7}(?:[ \u00a0]?[A-Z0-9]{1,4})?(?![A-Z0-9])/g;

const lengths: Record<string, number> = { FR: 27, DE: 22, BE: 16, ES: 24, IT: 27, LU: 20, NL: 18, CH: 21, GB: 22, PT: 25, MC: 27, AT: 20, IE: 22 };

export function ibanIsValid(candidate: string): boolean {
  const compact = candidate.replace(/[ \u00a0]/g, "").toUpperCase();
  const country = compact.slice(0, 2);
  const expected = lengths[country];
  if (expected !== undefined && compact.length !== expected) return false;
  if (compact.length < 15 || compact.length > 34) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  return mod97(digits) === 1;
}

function looksLikeMistypedIban(candidate: string): boolean {
  const compact = candidate.replace(/[ \u00a0]/g, "").toUpperCase();
  return lengths[compact.slice(0, 2)] === compact.length;
}

export const iban: Rule = {
  category: "iban",
  detect(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const match of text.matchAll(pattern)) {
      const valid = ibanIsValid(match[0]);
      if (!valid && !looksLikeMistypedIban(match[0])) continue;
      findings.push({ category: "iban", value: match[0], start: match.index, end: match.index + match[0].length, origin: valid ? "clé valide" : "suggestion à relire" });
    }
    return findings;
  },
};
