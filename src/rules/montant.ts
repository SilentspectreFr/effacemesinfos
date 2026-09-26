import type { Finding, Rule } from "./types";

const number = "\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d{1,3}(?:[ \\u00a0\\u202f.'’]\\d{3})*(?:[,.]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";
const unit = "€|EUR|euros?|k€|M€|USD|dollars?|\\$|£|GBP|CHF";
const prefix = "€|\\$|£|EUR|USD|GBP|CHF";
const pattern = new RegExp(`(?<![\\d,.])(?:(?:${number})[ \\u00a0]?(?:${unit})|(?<![\\p{L}])(?:${prefix})[ \\u00a0]?(?:${number}))(?![\\d\\p{L}]|[.,'’]\\d)`, "giu");

export const montant: Rule = {
  category: "montant",
  detect(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const match of text.matchAll(pattern)) {
      findings.push({ category: "montant", value: match[0], start: match.index, end: match.index + match[0].length, origin: "format reconnu" });
    }
    return findings;
  },
};
