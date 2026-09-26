import { digitSum, luhn } from "./checksum";
import type { Finding, Rule } from "./types";

const pattern = /(?<![\p{L}\p{N}])\d{3}[ \u00a0]?\d{3}[ \u00a0]?\d{3}(?:[ \u00a0]?\d{5})?(?![\p{L}\p{N}])/gu;

const laPoste = "356000000";

export function sirenIsValid(digits: string): boolean {
  return digits.length === 9 && luhn(digits);
}

export function siretIsValid(digits: string): boolean {
  if (digits.length !== 14) return false;
  if (digits.startsWith(laPoste)) return digitSum(digits) % 5 === 0;
  return luhn(digits);
}

export const siren: Rule = {
  category: "siren",
  detect(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const match of text.matchAll(pattern)) {
      const compact = match[0].replace(/[ \u00a0]/g, "");
      const isSiret = compact.length === 14;
      const valid = isSiret ? siretIsValid(compact) : sirenIsValid(compact);
      if (!valid) continue;
      findings.push({ category: isSiret ? "siret" : "siren", value: match[0], start: match.index, end: match.index + match[0].length, origin: "clé valide" });
    }
    return findings;
  },
};
