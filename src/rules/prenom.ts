import type { Finding, Rule } from "./types";
import list from "./prenoms.txt?raw";

const known = new Set(list.split("\n").filter(Boolean));
const isFirstName = (word: string) => known.has(word.toLocaleLowerCase("fr"));

const edge = "(?<![\\p{L}\\p{N}'’-])";
const word = "\\p{Lu}[\\p{L}'’-]*\\p{L}(?![\\p{L}\\p{N}'’-])";
const space = "[ \\u00a0]+";
const spaceOrBreak = "(?:[ \\u00a0]*\\n[ \\u00a0]*|[ \\u00a0]+)";
const lineBreak = /[ \u00a0]*\n[ \u00a0]*/g;
const particle = `(?:(?:de|du|des|van|von|der|den|da|di|dos|del)${space})?`;
const firstThenName = new RegExp(`${edge}(?=(((${word})${spaceOrBreak}(${particle}${word}))(?:${space}(${particle}${word}))?))`, "gu");
const nameThenFirst = new RegExp(`${edge}(?=((?![LD]['’])(\\p{Lu}[\\p{Lu}'’-]*\\p{Lu})${spaceOrBreak}(${word})))`, "gu");
const place = /(?:rue|avenue|av\.|boulevard|bd|place|quai|allée|impasse|chemin|square|cours|lycée|collège|école|université|hôpital|clinique|stade|salle|centre|saint|sainte|st\.?|ste|street|road)[  ]+$/iu;

function person(text: string, start: number, value: string): Finding[] {
  if (place.test(text.slice(Math.max(0, start - 20), start))) return [];
  return [{ category: "personne", value: value.replace(lineBreak, " "), start, end: start + value.length, origin: "suggestion à relire" }];
}

export const prenom: Rule = {
  category: "personne",
  detect(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const match of text.matchAll(firstThenName)) {
      const [, three, two, first, second, third] = match;
      if (!isFirstName(first!)) continue;
      findings.push(...person(text, match.index, third && isFirstName(second!) ? three! : two!));
    }
    for (const match of text.matchAll(nameThenFirst)) {
      const [, value, last, first] = match;
      if (isFirstName(first!) && !isFirstName(last!)) findings.push(...person(text, match.index, value!));
    }
    return findings;
  },
};
