import type { Finding, Rule } from "./types";

const pattern = /(?<![\d+])(?:\+33[\s.]?\(?0?\)?[\s.]?[1-9]|0[1-9])(?:[\s.-]?\d{2}){4}(?!\d)/g;

export const telephone: Rule = {
  category: "telephone",
  detect(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const match of text.matchAll(pattern)) {
      findings.push({ category: "telephone", value: match[0], start: match.index, end: match.index + match[0].length, origin: "format reconnu" });
    }
    return findings;
  },
};
