import type { Source } from "./state";

export interface Warning {
  text: string;
  details: string[];
}

const invisibleParts: Record<string, string> = {
  "texte masqué": "Du texte est marqué « masqué » dans Word : invisible à l'écran, présent dans le fichier.",
  "textes alternatifs": "Des images portent une description, lue par les lecteurs d'écran.",
  "zones de texte": "Des zones de texte flottantes ne sont pas relues.",
  "vignette": "Une image d'aperçu du document est enregistrée dans le fichier.",
};

const inspectInWord = "Pour les voir dans Word : Fichier › Informations › Vérifier la présence de problèmes › Inspecter le document.";

const plain = (text: string): Warning => ({ text, details: [] });

export function sourceWarnings(source: Source): Warning[] {
  if (source.format === "pdf" && source.diagnostic) {
    const diagnostic = source.diagnostic;
    const warnings = diagnostic.warnings.map(plain);
    if (diagnostic.kind === "mixte") warnings.unshift(plain(`${diagnostic.imagePages} ${diagnostic.imagePages > 1 ? "pages sur" : "page sur"} ${diagnostic.pages} ${diagnostic.imagePages > 1 ? "sont des images" : "est une image"} : le texte n'y est pas lu, tracez-y les zones à la main.`));
    if (diagnostic.kind === "signe") warnings.unshift(plain("Signature électronique perdue dans la copie."));
    return warnings;
  }
  if (source.format === "docx" && source.inspection) {
    const parts = source.inspection.warnings;
    if (!parts.length) return [];
    return [{
      text: "Ce document contient du texte invisible, que l'outil ne traite pas.",
      details: [...parts.map((part) => invisibleParts[part] ?? part), inspectInWord],
    }];
  }
  const warnings: Warning[] = [];
  if (source.textExtension === "md" || source.textExtension === "markdown") warnings.push(plain("Vérifiez la mise en forme Markdown de la copie."));
  if (source.textEncoding === "windows-1252") warnings.push(plain("Encodage Windows : vérifiez les accents. La copie sera en UTF-8."));
  return warnings;
}
