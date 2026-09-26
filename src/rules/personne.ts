import type { Finding, Rule } from "./types";

const civility = "M(?:onsieur|ONSIEUR)?|MM|Mme|MME|Madame|MADAME|Mlle|Mademoiselle|Mrs|Mr|Ms|Miss|Sir|Ma[iî]tre|MAITRE|Me|Dr|DR|Docteur|DOCTEUR|Pr|Professeur";
const name = "\\p{Lu}[\\p{L}'’-]*\\p{L}";
const afterCivility = new RegExp(`(?<![\\p{L}])(?:${civility})\\.?[ \\u00a0]+(${name}(?:[ \\u00a0]+${name}){0,2})(?![\\p{L}])`, "gu");

export const personne: Rule = {
  category: "personne",
  detect(text: string): Finding[] {
    return [...text.matchAll(afterCivility)].map((match) => {
      const value = match[1]!;
      const start = match.index + match[0].indexOf(value);
      return { category: "personne", value, start, end: start + value.length, origin: "suggestion à relire" };
    });
  },
};
