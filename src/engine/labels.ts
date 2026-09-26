import type { Category } from "../rules/types";

const fixed: Partial<Record<Category, string>> = {
  courriel: "[adresse électronique]",
  telephone: "[téléphone]",
  iban: "[IBAN]",
  bic: "[BIC]",
  nir: "[numéro de sécurité sociale]",
  siren: "[SIREN]",
  siret: "[SIRET]",
  tva: "[numéro de TVA]",
  montant: "[montant]",
  date: "[date]",
  identifiant: "[référence]",
};

const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function createLabeler() {
  const assigned = new Map<string, string>();
  let next = 0;
  return (category: Category, value: string): string => {
    const known = fixed[category];
    if (known) return known;
    const key = value.toLocaleLowerCase("fr");
    const existing = assigned.get(key);
    if (existing) return existing;
    const suffix = next >= letters.length ? String(Math.floor(next / letters.length) + 1) : "";
    const label = `[Partie ${letters[next % letters.length]}${suffix}]`;
    next++;
    assigned.set(key, label);
    return label;
  };
}
