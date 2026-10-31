import type { Finding, Rule } from "./types";

const pattern = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;

export const courriel: Rule = {
  category: "courriel",
  detect(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const match of text.matchAll(pattern)) {
      findings.push({ category: "courriel", value: match[0], start: match.index, end: match.index + match[0].length, origin: "format reconnu" });
    }
    return findings;
  },
};
