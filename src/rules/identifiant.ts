import type { Finding, Rule } from "./types";

const pattern = /(?<![\p{L}\p{N}])(?:[A-Z]{1,3}-?\d{5,}[A-Z0-9-]*|\d{5,}-?[A-Z]{1,3}[A-Z0-9-]*)(?![\p{L}\p{N}])/gu;

export const identifiant: Rule = {
  category: "identifiant",
  detect(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const match of text.matchAll(pattern)) {
      findings.push({ category: "identifiant", value: match[0], start: match.index, end: match.index + match[0].length, origin: "suggestion à relire" });
    }
    return findings;
  },
};
