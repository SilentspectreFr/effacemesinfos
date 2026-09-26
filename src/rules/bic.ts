import type { Finding, Rule } from "./types";

const pattern = /\b(?:BIC|SWIFT)\s*:?\s*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/g;

export const bic: Rule = {
  category: "bic",
  detect(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const match of text.matchAll(pattern)) {
      const value = match[1]!;
      const start = match.index + match[0].lastIndexOf(value);
      findings.push({ category: "bic", value, start, end: start + value.length, origin: "format reconnu" });
    }
    return findings;
  },
};
