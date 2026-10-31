import type { Actions } from "./actions";
import { demoText } from "./demo";
import { el, icon, plural } from "./dom";
import { temporaryUrl } from "./liens";
import { safeFileName } from "./nom-fichier";
import type { ExportResult } from "./state";

const stepLabels = { depot: [1, "Document"], relecture: [2, "Vérifier"], resultat: [3, "Récupérer"] } as const;

export function renderProgress(actions: Actions) {
  const [number, label] = stepLabels[actions.state.step];
  return el("div", { class: "progression", "data-etape": number },
    el("div", { class: "ligne" },
      el("p", {}, el("span", { class: "numero" }, `Étape ${number} sur 3`), ` · ${label}`),
      actions.state.step === "relecture" && el("button", { class: "lien", type: "button", click: () => actions.back("depot") }, icon("retour"), "Changer de document"),
    ),
    el("div", { class: "jauge", "aria-hidden": "true" }, el("span", {})),
  );
}

export function renderDepot(actions: Actions) {
  const textarea = el("textarea", { rows: 7, placeholder: "Collez votre texte ici", "aria-label": "Texte à traiter" });
  const input = el("input", {
    id: "fichier",
    type: "file",
    accept: ".pdf,.docx,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown",
    change: () => { const file = input.files?.[0]; if (file) actions.openFile(file); },
  });
  const zone = el("label", { class: "zone-depot", for: "fichier" },
    icon("depot"),
    el("span", { class: "titre" }, "Déposez votre document"),
    el("span", { class: "detail" }, "PDF, Word, texte ou Markdown"),
    el("span", { class: "bouton principal" }, "Choisir un fichier"),
    input,
  );
  zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("survol"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("survol"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("survol");
    const file = event.dataTransfer?.files[0];
    if (file) actions.openFile(file);
  });
  return el("section", { class: "depot" },
    el("h1", {}, "Effacez les informations sensibles"),
    zone,
    el("details", { class: "coller" },
      el("summary", {}, "Ou coller un texte"),
      textarea,
      el("button", { class: "bouton", type: "button", click: () => actions.openText(textarea.value) }, "Continuer"),
    ),
    el("p", { class: "exemple" }, el("button", { class: "lien", type: "button", click: () => actions.openText(demoText, "Exemple fictif") }, "Essayer avec un exemple")),
    el("p", { class: "rassurance" }, icon("cadenas"), "Votre document reste sur votre appareil."),
  );
}

export function renderResultat(actions: Actions) {
  const result = actions.state.result!;
  const watched = result.findings.length > 0;
  const url = temporaryUrl(new Blob([result.bytes.buffer as ArrayBuffer], { type: result.mime }));
  const reportUrl = temporaryUrl(new Blob([result.compteRendu], { type: "text/plain;charset=utf-8" }));
  const download = el("a", { class: "bouton principal", href: url, download: result.fileName }, icon("telecharger"), "Télécharger la copie");
  const done = [
    result.removed > 0 && plural(result.removed, "information effacée", "informations effacées"),
    result.zones > 0 && plural(result.zones, "zone effacée", "zones effacées"),
    result.images > 0 && plural(result.images, "image retirée", "images retirées"),
    result.pagesRead > 0 && plural(result.pagesRead, "page lue", "pages lues"),
  ].filter(Boolean).join(" · ");
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(result.text ?? "");
      actions.notify("Texte copié.");
    } catch {
      actions.notify("Copie refusée par le navigateur. Téléchargez le fichier.");
    }
  };
  return el("section", { class: "resultat" },
    el("div", { class: "entete-resultat" }, el("span", { class: "rond" }, icon("valide")), el("div", {},
      el("h1", {}, "Votre copie est prête"),
      done && el("p", { class: "chiffre" }, done),
    )),
    watched && renderWatchList(actions),
    renderFileName(result, download),
    el("div", { class: "actions" },
      download,
      result.text !== null && el("button", { class: "bouton", type: "button", click: copyText }, icon("copier"), "Copier le texte"),
    ),
    el("p", { class: "portee" }, watched || result.pagesRead > 0
      ? "Relisez-la avant de la partager."
      : "Rien de ce que vous avez sélectionné n'y a été retrouvé. Relisez-la avant de la partager : l'outil ne voit pas tout."),
    el("details", { class: "verifications" },
      el("summary", {}, "Voir les vérifications"),
      el("ul", {}, ...result.summary.map((line) => el("li", {}, line))),
      el("a", { href: reportUrl, download: "compte-rendu.txt" }, "Télécharger le compte rendu"),
    ),
    el("div", { class: "actions secondaires" },
      el("button", { class: "bouton discret", type: "button", click: () => actions.back("relecture") }, icon("retour"), "Retour"),
      el("button", { class: "bouton discret", type: "button", click: () => actions.back("depot") }, "Autre document"),
    ),
    el("p", { class: "partage" }, el("a", { href: "/", target: "_blank" }, "Faire découvrir EffaceMesInfos"), " · ", el("a", { href: "https://flowxify.com/accompagnement/", target: "_blank", rel: "noopener" }, "Découvrir Flowxify")),
  );
}

function renderWatchList(actions: Actions) {
  const result = actions.state.result!;
  return el("div", { class: "a-surveiller", role: "status" },
    icon("alerte"),
    el("div", {},
      el("h2", {}, "Encore présent dans la copie"),
      el("ul", {}, ...result.findings.map((line) => el("li", {}, line))),
      result.residualPages.length > 0
        ? el("button", { class: "bouton", type: "button", click: () => actions.produce(result.residualPages) }, `Passer en image ${result.residualPages.length > 1 ? "les pages" : "la page"} ${result.residualPages.join(", ")}`)
        : el("button", { class: "bouton", type: "button", click: () => actions.back("relecture") }, "Revoir le document"),
    ),
  );
}

function renderFileName(result: ExportResult, download: HTMLAnchorElement) {
  const extension = result.fileName.slice(result.fileName.lastIndexOf(".") + 1);
  const input = el("input", {
    id: "nom-copie",
    type: "text",
    value: result.fileName,
    spellcheck: "false",
    autocomplete: "off",
    change: () => { input.value = result.fileName; },
    input: () => {
      result.fileName = safeFileName(input.value, extension);
      download.download = result.fileName;
    },
  });
  const unchecked = result.removed === 0;
  return el("div", { class: "nom-copie" },
    el("label", { for: "nom-copie" }, "Nom de la copie"),
    input,
    el("p", {}, unchecked
      ? "Vérifiez qu'il ne contient rien de sensible."
      : "Les informations effacées en ont aussi été retirées."),
  );
}
