export type Category = "mot" | "personne" | "capitales" | "courriel" | "telephone" | "iban" | "bic" | "nir" | "siren" | "siret" | "tva" | "montant" | "date" | "identifiant" | "douteux";

export type Origin = "mot demandé" | "clé valide" | "format reconnu" | "suggestion à relire";

export interface Finding {
  category: Category;
  value: string;
  start: number;
  end: number;
  origin: Origin;
}

export interface Rule {
  category: Category;
  detect(text: string): Finding[];
}
