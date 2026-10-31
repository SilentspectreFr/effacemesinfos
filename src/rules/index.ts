import { bic } from "./bic";
import { capitales } from "./capitales";
import { courriel } from "./courriel";
import { date } from "./date";
import { identifiant } from "./identifiant";
import { iban } from "./iban";
import { montant } from "./montant";
import { regroup, restore } from "./espacees";
import { detectWords } from "./mots";
import { nir } from "./nir";
import { personne } from "./personne";
import { prenom } from "./prenom";
import { siren } from "./siren";
import { telephone } from "./telephone";
import { tva } from "./tva";
import type { Category, Finding, Origin, Rule } from "./types";

export type { Category, Finding, Origin } from "./types";

const rules: Rule[] = [iban, nir, tva, siren, bic, courriel, telephone, montant, date, identifiant, personne, prenom, capitales];

const priority: Record<Origin, number> = { "mot demandé": 4, "clé valide": 3, "format reconnu": 2, "suggestion à relire": 1 };

function resolveOverlaps(findings: Finding[]): Finding[] {
  const sorted = [...findings].sort((a, b) => priority[b.origin] - priority[a.origin] || b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: Finding[] = [];
  for (const finding of sorted) {
    if (kept.some((k) => k.start <= finding.start && finding.end <= k.end)) continue;
    kept.push(finding);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function detect(text: string, words: string[] = [], { espacees = true } = {}): Finding[] {
  const regrouped = espacees ? regroup(text) : null;
  const found = regrouped ? rules.flatMap((rule) => rule.detect(regrouped.text)).map((finding) => restore(text, regrouped.origin, finding)) : rules.flatMap((rule) => rule.detect(text));
  const findings = [...detectWords(text, words), ...found];
  return resolveOverlaps(findings);
}

export const categoryLabels: Record<Category, string> = {
  mot: "Mots demandés",
  personne: "Noms possibles",
  capitales: "Mots en capitales",
  courriel: "Adresses électroniques",
  telephone: "Téléphones",
  iban: "IBAN",
  bic: "BIC",
  nir: "Numéros de sécurité sociale",
  siren: "SIREN",
  siret: "SIRET",
  tva: "Numéros de TVA",
  montant: "Montants",
  date: "Dates",
  identifiant: "Références et numéros de dossier",
  douteux: "Passages mal lus",
};

const keptByDefault = new Set<Category>(["montant", "date", "identifiant", "capitales", "douteux"]);

export function isPreselected(finding: Finding): boolean {
  return !keptByDefault.has(finding.category);
}
