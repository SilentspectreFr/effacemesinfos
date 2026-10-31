import type { Finding, Rule } from "./types";

const months = "[Jj]anvier|[Ff]évrier|[Mm]ars|[Aa]vril|[Mm]ai|[Jj]uin|[Jj]uillet|[Aa]oût|[Ss]eptembre|[Oo]ctobre|[Nn]ovembre|[Dd]écembre|JANVIER|FÉVRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AOÛT|SEPTEMBRE|OCTOBRE|NOVEMBRE|DÉCEMBRE";
const monthsEn = "[Jj]anuary|[Ff]ebruary|[Mm]arch|[Aa]pril|[Mm]ay|[Jj]une|[Jj]uly|[Aa]ugust|[Ss]eptember|[Oo]ctober|[Nn]ovember|[Dd]ecember|JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER";
const day = "(?:0?[1-9]|[12]\\d|3[01])";
const numeric = `(?<!\\d)${day}[ \\u00a0]?[-/.–][ \\u00a0]?(?:0?[1-9]|1[0-2])[ \\u00a0]?[-/.–][ \\u00a0]?(?:19|20)\\d{2}(?!\\d)`;
const written = `(?<![\\p{L}\\p{N}])(?:1er|${day})[ \\u00a0]+(?:${months})[ \\u00a0]+(?:19|20)\\d{2}(?![\\p{L}\\p{N}])`;
const ordinal = `${day}(?:st|nd|rd|th)?`;
const writtenEn = `(?<![\\p{L}\\p{N}])(?:${ordinal}[ \\u00a0]+(?:of[ \\u00a0]+)?(?:${monthsEn}),?[ \\u00a0]+|(?:${monthsEn})[ \\u00a0]+${ordinal},?[ \\u00a0]+)(?:19|20)\\d{2}(?![\\p{L}\\p{N}])`;
const pattern = new RegExp(`${numeric}|${written}|${writtenEn}`, "gu");

export const date: Rule = {
  category: "date",
  detect(text: string): Finding[] {
    const findings: Finding[] = [];
    for (const match of text.matchAll(pattern)) {
      findings.push({ category: "date", value: match[0], start: match.index, end: match.index + match[0].length, origin: "suggestion à relire" });
    }
    return findings;
  },
};
