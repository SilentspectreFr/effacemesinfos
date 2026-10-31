import type { Finding, Rule } from "./types";

const acronyms = new Set(["SARL", "SAS", "SASU", "EURL", "SCI", "SNC", "IBAN", "BIC", "TVA", "SIRET", "SIREN", "RCS", "HT", "TTC", "PDF", "URL", "CEDEX", "NIR", "INSEE", "CPAM", "EDF", "SNCF", "RIB", "SEPA", "LOT", "REF", "TEL", "FAX", "MAIL", "TOTAL"]);
const upperWord = /(?<![\p{L}\p{N}])\p{Lu}[\p{Lu}'’-]*\p{Lu}(?![\p{L}\p{N}])/gu;

export const capitales: Rule = {
  category: "capitales",
  detect(text: string): Finding[] {
    return [...text.matchAll(upperWord)]
      .filter((match) => !acronyms.has(match[0]))
      .map((match) => ({ category: "capitales", value: match[0], start: match.index, end: match.index + match[0].length, origin: "suggestion à relire" }));
  },
};
