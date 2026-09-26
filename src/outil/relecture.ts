import { categoryLabels, type Category, type Origin } from "../rules";
import { detectWords } from "../rules/mots";
import type { DocxBlock, DocxParagraph, DocxPlacedImage, DocxRun } from "../engine/docx";
import type { Rect, TextLine } from "../engine/types";
import type { Actions } from "./actions";
import { previewSegments, type Segment } from "./apercu";
import { sourceWarnings, type Warning } from "./diagnostic";
import { el, icon, plural, prefersCalm, replaceChildren } from "./dom";
import { addWord as addWordToState, choose, commit, dismissItem, labelsFor, redo, removeWord, sameRect, selectedItems, toggleImageRemoval, toggleImageZone, undo, zoneCount, type Item, type State } from "./state";

type View = "elements" | "apercu";
type Rendering = "original" | "resultat";
type Tool = "lecture" | "texte" | "zone";

const categoryOrder: Category[] = ["mot", "personne", "capitales", "courriel", "telephone", "iban", "bic", "nir", "siren", "siret", "tva", "identifiant", "montant", "date", "douteux"];

const categoryNames: Record<Category, string> = {
  mot: "Mot ajouté",
  personne: "Nom possible",
  capitales: "Mot en capitales",
  courriel: "Adresse électronique",
  telephone: "Téléphone",
  iban: "IBAN",
  bic: "BIC",
  nir: "N° de sécurité sociale",
  siren: "SIREN",
  siret: "SIRET",
  tva: "N° de TVA",
  montant: "Montant",
  date: "Date",
  identifiant: "Référence",
  douteux: "Passage mal lu",
};

const originNames: Record<Origin, string> = {
  "mot demandé": "ajouté",
  "clé valide": "clé valide",
  "format reconnu": "format reconnu",
  "suggestion à relire": "suggestion",
};

const alignments: Record<string, string> = { center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };
const highlights: Record<string, string> = { yellow: "#fff59d", green: "#c8f7c5", cyan: "#c5f1f7", magenta: "#f7c5ec", red: "#f7c5c5", blue: "#c5d9f7", lightGray: "#e5e5ea", darkYellow: "#f5e3a3", darkGreen: "#c9e4c5", darkCyan: "#c2e0e0", darkMagenta: "#e3c5e8", darkRed: "#ebc2c2", darkBlue: "#c2cbe8", darkGray: "#d2d2d7" };

function isPale(color: string): boolean {
  const [red, green, blue] = [0, 2, 4].map((index) => parseInt(color.slice(index, index + 2), 16));
  return 0.299 * red! + 0.587 * green! + 0.114 * blue! > 215;
}

const coachKey = "effacemesinfos.conseil-vu";
const selectionLimit = 120;
const excerptLimit = 3;
const excerptMargin = 32;
const tapSpanLimit = 60;
const bubbleTopLimit = 72;
const wordCharacter = /[\p{L}\p{N}'’-]/u;
const wordJoiner = /['’-]/;

const session = {
  filter: "",
  view: "apercu" as View,
  rendering: "original" as Rendering,
  drawing: false,
  reading: null as boolean | null,
  focused: null as string | null,
  occurrence: 0,
  scroll: { elements: 0, apercu: 0 } as Record<View, number>,
  open: new Set<string>(),
};

function coachSeen(): boolean {
  try {
    return localStorage.getItem(coachKey) === "1";
  } catch {
    return false;
  }
}

function rememberCoach() {
  try {
    localStorage.setItem(coachKey, "1");
  } catch {
    return;
  }
}

let active: { refresh(): void; history(forward: boolean): void; selection(): void; notice(): void } | null = null;
let watchingSelection = false;

export function resetReview() {
  Object.assign(session, { filter: "", view: "apercu", rendering: "original", drawing: false, reading: null, focused: null, occurrence: 0, scroll: { elements: 0, apercu: 0 }, open: new Set<string>() });
}

export function releaseReview() {
  active = null;
  resetReview();
}

export function refreshReview() {
  active?.refresh();
}

export function refreshNotice() {
  active?.notice();
}


const secondsPerPage = 1.5;

function duration(seconds: number): string {
  if (seconds < 60) return "moins d'une minute";
  return `environ ${Math.round(seconds / 60)} min`;
}

export function handleShortcut(event: KeyboardEvent, state: State) {
  if (state.step !== "relecture" || !active) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea")) return;
  const key = event.key.toLowerCase();
  if (!(event.metaKey || event.ctrlKey)) return;
  if (key === "z") {
    event.preventDefault();
    active.history(event.shiftKey);
  } else if (key === "y") {
    event.preventDefault();
    active.history(true);
  }
}

function watchSelection() {
  if (watchingSelection) return;
  watchingSelection = true;
  document.addEventListener("selectionchange", () => active?.selection());
}

export function renderRelecture(actions: Actions): HTMLElement {
  const { state } = actions;
  const source = state.source!;
  const isPdf = source.format === "pdf";
  const scanned = isPdf && source.diagnostic?.kind === "scan";
  const isScan = scanned && !source.read;
  const wide = window.matchMedia("(min-width: 900px)");
  const touch = window.matchMedia("(pointer: coarse)").matches;
  if (scanned) session.drawing = isScan;
  const offersReading = isPdf && !scanned && !wide.matches;
  if (session.reading === null) session.reading = offersReading;
  if (!offersReading) session.reading = false;

  const tabItems = el("button", { class: "onglet", type: "button", role: "tab", click: () => switchView("elements") });
  const tabPreview = el("button", { class: "onglet", type: "button", role: "tab", click: () => switchView("apercu") }, "Document");
  const list = el("div", { class: "liste" });
  const zonesHolder = el("div", { class: "zones" });
  const imagesHolder = el("div", { class: "images" });
  const preview = el("div", { class: "feuilles" });
  const bubble = el("button", { class: "bulle-selection", type: "button", hidden: "", pointerdown: (event) => event.preventDefault(), click: addSelection });
  let bubbleText = "";
  let tapRange: Range | null = null;
  const tapLayer = el("div", { class: "calque-toucher", "aria-hidden": "true" });
  let lastPointer = "mouse";
  const counter = el("p", { class: "total", "aria-live": "polite" });
  const undoButton = el("button", { class: "bouton icone-seule", type: "button", title: "Annuler (Ctrl+Z)", "aria-label": "Annuler", click: () => history(false) }, icon("annuler"));
  const redoButton = el("button", { class: "bouton icone-seule", type: "button", title: "Rétablir (Ctrl+Maj+Z)", "aria-label": "Rétablir", click: () => history(true) }, icon("retablir"));
  const createButton = el("button", { class: "bouton principal", type: "button", click: () => actions.produce() }, "Créer la copie");
  const tools: [Tool, Parameters<typeof icon>[0], string][] = offersReading
    ? [["lecture", "texte", "Lecture"], ["texte", "page", "Page"], ["zone", "rectangle", "Zone"]]
    : [["texte", "curseur", "Texte"], ["zone", "rectangle", "Zone"]];
  const toolButtons = tools.map(([tool, symbol, label]) =>
    el("button", { type: "button", "data-outil": tool, click: () => setTool(tool) }, icon(symbol), label));
  const copyToggle = el("button", { class: "bouton discret", type: "button", click: () => setRendering(session.rendering === "original" ? "resultat" : "original") }, icon("oeil"), "Voir la copie");
  const coach = renderCoach();

  const searchInput = el("input", {
    type: "search",
    value: session.filter,
    placeholder: "Mot exact, ex. Dupont",
    "aria-label": "Rechercher un mot à effacer partout",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    enterkeyhint: "done",
    input: (event) => { session.filter = (event.target as HTMLInputElement).value; refreshSearch(); },
    keydown: (event) => { if ((event as KeyboardEvent).key === "Enter") { event.preventDefault(); eraseSearched(); } },
  });
  const searchResults = el("div", { class: "resultats-recherche", "aria-live": "polite" });
  const search = el("div", { class: "recherche", role: "search" },
    el("label", { class: "champ-recherche" }, icon("loupe"), searchInput),
    searchResults,
  );

  const scanNotice = el("div", { class: "annonce-scan", role: "note" });
  const lead = scanned ? el("div", {}, scanNotice, !isScan && search) : search;

  const feedback = el("div", { class: "retour-selection", role: "status", hidden: true });
  let feedbackTimer = 0;
  const panelHeader = el("div", { class: "entete-panneau" }, counter);
  const documentPane = el("div", { class: "document" },
    el("div", { class: "outils" },
      isPdf && !isScan && el("div", { class: "bascule outil", role: "group", "aria-label": "Outil" }, ...toolButtons),
      coach,
      !isPdf && copyToggle,
    ),
    preview,
  );
  const panel = el("aside", { class: "panneau", "aria-label": "À effacer" },
    panelHeader,
    ...sourceWarnings(source).map(renderWarning),
    !isScan && el("p", { class: "mention-regles" }, "Repérés par des règles, pas par une IA. Vérifiez chaque ligne."),
    !isScan && list,
    imagesHolder,
    isPdf && zonesHolder,
  );

  const section = el("section", { class: "relecture", "data-vue": session.view, "data-rendu": session.rendering },
    el("div", { class: "onglets", role: "tablist", "aria-label": "Affichage" }, tabPreview, tabItems),
    documentPane,
    panel,
    el("div", { class: "barre-action" },
      el("div", { class: "historique" }, undoButton, redoButton),
      el("p", { class: "prudence" }, isScan ? "" : "La détection peut en manquer : relisez."),
      createButton,
    ),
    feedback,
  );
  preview.append(bubble);
  preview.addEventListener("pointerdown", (event) => { lastPointer = event.pointerType; });
  preview.addEventListener("click", onPreviewTap);
  placeLead();
  wide.addEventListener("change", placeLead);

  function placeLead() {
    if (wide.matches) panelHeader.after(lead);
    else documentPane.prepend(lead);
  }

  function renderWarning(warning: Warning) {
    if (!warning.details.length) return el("p", { class: "avertissement" }, warning.text);
    return el("details", { class: "avertissement" },
      el("summary", {}, warning.text),
      el("ul", {}, ...warning.details.map((detail) => el("li", {}, detail))),
    );
  }

  function renderCoach() {
    if (scanned || coachSeen() || touch) return null;
    const box = el("div", { class: isPdf ? "conseil" : "conseil sans-fleche", role: "note" },
      el("span", {}, "Sélectionnez un mot pour l'effacer"),
      el("button", { type: "button", "aria-label": "Fermer", click: () => dismissCoach() }, "×"),
    );
    return box;
  }

  function dismissCoach() {
    rememberCoach();
    coach?.remove();
  }

  function mutate(change: () => void, anchor?: string) {
    hideFeedback();
    const before = anchor ? rowTop(anchor) : null;
    commit(state, change);
    refresh();
    if (!anchor || before === null) return;
    keepAnchor(anchor, before);
    focusRow(anchor);
  }

  function focusRow(key: string) {
    const row = list.querySelector<HTMLElement>(`.ligne[data-cle="${CSS.escape(key)}"]`);
    row?.querySelector<HTMLElement>(".case input, .corps")?.focus({ preventScroll: true });
  }

  function history(forward: boolean) {
    const words = state.words.join("\n");
    const moved = forward ? redo(state) : undo(state);
    if (!moved) return;
    hideFeedback();
    refresh();
    if (isPdf && words !== state.words.join("\n")) actions.syncLocated().then(refresh);
  }

  function eraseSearched() {
    const word = session.filter.trim();
    if (!searchable(word) || alreadyErased(word) || !detectWords(source.text, [word]).length) return;
    session.filter = "";
    searchInput.value = "";
    searchInput.blur();
    addWord(word);
    showSelectionFeedback(word);
  }

  function searchable(word: string): boolean {
    return word.length >= 2;
  }

  function alreadyErased(word: string): boolean {
    const matches = state.items.filter((item) => item.category === "mot" && item.value.toLocaleLowerCase("fr") === word.toLocaleLowerCase("fr"));
    return matches.length > 0 && matches.every((item) => state.selected.has(item.key));
  }

  function refreshSearch() {
    replaceChildren(searchResults, renderSearchResults());
  }

  function renderSearchResults() {
    const word = session.filter.trim();
    if (word.split(/\s+/).length > 3) return el("p", { class: "etat-recherche" }, "Tapez le mot exact à effacer. L'outil ne suit pas de consignes.");
    if (!searchable(word)) return touch ? el("p", { class: "etat-recherche" }, "Ou touchez un mot dans le document.") : null;
    if (alreadyErased(word)) return el("p", { class: "etat-recherche" }, "Déjà effacé.");
    const findings = detectWords(source.text, [word]);
    if (!findings.length) return el("p", { class: "etat-recherche" }, "Absent du document.");
    const rest = findings.length - excerptLimit;
    return el("div", {},
      el("div", { class: "action-recherche" },
        el("span", {}, plural(findings.length, "passage")),
        el("button", { class: "bouton principal", type: "button", click: eraseSearched }, icon("gomme"), "Effacer partout"),
      ),
      el("ul", { class: "extraits" },
        ...findings.slice(0, excerptLimit).map((finding) => el("li", {}, ...excerpt(finding.start, finding.end))),
        rest > 0 && el("li", { class: "autres" }, `et ${plural(rest, "autre")}`),
      ),
    );
  }

  function excerpt(start: number, end: number) {
    const text = source.text;
    const from = Math.max(0, start - excerptMargin);
    const to = Math.min(text.length, end + excerptMargin);
    const before = text.slice(from, start).replace(/\s+/g, " ");
    const after = text.slice(end, to).replace(/\s+/g, " ");
    const shownBefore = from > 0 ? `…${before.replace(/^\S*\s/, "")}` : before;
    const shownAfter = to < text.length ? `${after.replace(/\s\S*$/, "")}…` : after;
    return [shownBefore, el("mark", {}, text.slice(start, end).replace(/\s+/g, " ")), shownAfter];
  }

  function addWord(word: string) {
    dismissCoach();
    mutate(() => addWordToState(state, word));
    if (isPdf) actions.syncLocated().then(refresh);
  }

  function selectedText(): string | null {
    if (session.rendering !== "original" || session.drawing) return null;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!preview.contains(range.commonAncestorContainer)) return null;
    const text = trimEdges(selection.toString().replace(/\s+/g, " "));
    if (!text || text.length > selectionLimit) return null;
    return wholeWords(text);
  }

  function trimEdges(text: string): string {
    return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  }

  function wholeWords(text: string): string | null {
    const tokens = text.split(" ");
    const candidates = [text, tokens.slice(0, -1).join(" "), tokens.slice(1).join(" "), tokens.slice(1, -1).join(" ")].map(trimEdges);
    return candidates.find((candidate) => candidate && detectWords(source.text, [candidate]).length > 0) ?? null;
  }

  function refreshSelection() {
    const text = selectedText();
    if (text) {
      forgetTap();
      showBubble(text, window.getSelection()!.getRangeAt(0).getBoundingClientRect());
      return;
    }
    if (tapRange) return;
    hideBubble();
  }

  function hideBubble() {
    bubble.hidden = true;
    bubbleText = "";
  }

  function onPreviewTap(event: MouseEvent) {
    if (lastPointer !== "touch" || session.drawing || session.rendering !== "original") return;
    if ((event.target as HTMLElement).closest(".surlignage, .zone, mark, .bulle-selection")) return;
    const word = wordAt(event.clientX, event.clientY);
    if (!word || (tapRange && covers(tapRange, word))) {
      clearTap();
      return;
    }
    const spanned = tapRange ? spanning(tapRange, word) : null;
    tapRange = spanned && spanned.toString().replace(/\s+/g, " ").trim().length <= tapSpanLimit ? spanned : word;
    showTap();
  }

  function showTap() {
    const text = tapRange && wholeWords(trimEdges(tapRange.toString().replace(/\s+/g, " ")));
    if (!tapRange || !text) {
      clearTap();
      return;
    }
    drawTap(tapRange);
    showBubble(text, tapRange.getBoundingClientRect(), true);
  }

  function drawTap(range: Range) {
    const box = preview.getBoundingClientRect();
    replaceChildren(tapLayer, ...[...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => {
      const mark = el("span", {});
      mark.style.left = `${rect.left - box.left}px`;
      mark.style.top = `${rect.top - box.top}px`;
      mark.style.width = `${rect.width}px`;
      mark.style.height = `${rect.height}px`;
      return mark;
    }));
    preview.append(tapLayer);
  }

  function forgetTap() {
    tapRange = null;
    replaceChildren(tapLayer);
    tapLayer.remove();
  }

  function clearTap() {
    forgetTap();
    hideBubble();
  }

  function wordAt(x: number, y: number): Range | null {
    const caret = caretAt(x, y);
    if (!caret || caret.node.nodeType !== Node.TEXT_NODE || !preview.contains(caret.node)) return null;
    const data = caret.node.textContent ?? "";
    let start = caret.offset;
    let end = caret.offset;
    while (start > 0 && wordCharacter.test(data[start - 1]!)) start--;
    while (end < data.length && wordCharacter.test(data[end]!)) end++;
    while (start < end && wordJoiner.test(data[start]!)) start++;
    while (end > start && wordJoiner.test(data[end - 1]!)) end--;
    if (start === end) return null;
    const range = document.createRange();
    range.setStart(caret.node, start);
    range.setEnd(caret.node, end);
    return range;
  }

  function caretAt(x: number, y: number): { node: Node; offset: number } | null {
    const positioned = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
    const position = positioned.caretPositionFromPoint?.(x, y);
    if (position) return { node: position.offsetNode, offset: position.offset };
    const range = document.caretRangeFromPoint?.(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }

  function covers(outer: Range, inner: Range): boolean {
    return outer.isPointInRange(inner.startContainer, inner.startOffset) && outer.isPointInRange(inner.endContainer, inner.endOffset);
  }

  function spanning(first: Range, second: Range): Range {
    const range = document.createRange();
    const secondFirst = first.compareBoundaryPoints(Range.START_TO_START, second) > 0;
    const [from, to] = secondFirst ? [second, first] : [first, second];
    range.setStart(from.startContainer, from.startOffset);
    range.setEnd(to.endContainer, to.endOffset);
    return range;
  }

  function showBubble(text: string, range: DOMRect, preferAbove = false) {
    bubbleText = text;
    const box = preview.getBoundingClientRect();
    bubble.hidden = false;
    const matches = state.items.filter((item) => item.category === "mot" && item.value.toLocaleLowerCase("fr") === text.toLocaleLowerCase("fr"));
    const alreadyMasked = matches.length > 0 && matches.every((item) => state.selected.has(item.key));
    const count = detectWords(source.text, [text]).length;
    replaceChildren(bubble, icon("gomme"), alreadyMasked
      ? "Déjà effacé"
      : el("span", { class: "texte-bulle" }, "Effacer ", el("span", { class: "mot-bulle" }, `« ${text} »`), ` partout · ${count}`));
    bubble.disabled = alreadyMasked;
    bubble.style.left = `${Math.max(0, Math.min(range.left - box.left, box.width - bubble.offsetWidth))}px`;
    const gap = 8;
    const above = range.top - bubble.offsetHeight - gap;
    const below = range.bottom + gap;
    const fitsAbove = above > bubbleTopLimit;
    const fitsBelow = below + bubble.offsetHeight < window.innerHeight - 90;
    bubble.style.top = `${((preferAbove ? fitsAbove || !fitsBelow : !fitsBelow) ? above : below) - box.top}px`;
  }

  function showSelectionFeedback(text: string) {
    const count = detectWords(source.text, [text]).length;
    replaceChildren(feedback,
      el("span", {}, `« ${text} » effacé · ${count}`),
      el("button", { class: "lien", type: "button", click: () => history(false) }, "Annuler"),
    );
    feedback.hidden = false;
    window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(hideFeedback, 5000);
  }

  function hideFeedback() {
    window.clearTimeout(feedbackTimer);
    feedback.hidden = true;
  }

  function addSelection() {
    const text = bubbleText;
    if (!text) return;
    window.getSelection()?.removeAllRanges();
    clearTap();
    addWord(text);
    showSelectionFeedback(text);
  }

  function switchView(next: View) {
    if (session.view === next) return;
    session.scroll[session.view] = window.scrollY;
    session.view = next;
    section.dataset.vue = next;
    refreshTabs();
    fitTextLayers();
    window.scrollTo({ top: session.scroll[next] });
  }

  function setRendering(mode: Rendering) {
    session.rendering = mode;
    section.dataset.rendu = mode;
    refreshRenderingButtons();
    clearTap();
    if (!isPdf) refreshPreview();
  }

  function currentTool(): Tool {
    return session.drawing ? "zone" : session.reading ? "lecture" : "texte";
  }

  function setTool(tool: Tool) {
    const wasReading = session.reading;
    session.reading = tool === "lecture";
    setDrawing(tool === "zone");
    if (wasReading !== session.reading) {
      refreshPreview();
      fitTextLayers();
    }
  }

  function setDrawing(drawing: boolean) {
    session.drawing = drawing;
    window.getSelection()?.removeAllRanges();
    clearTap();
    refreshDrawing();
  }

  function refresh() {
    refreshPreview();
    refreshList();
    refreshZones();
    refreshImages();
    refreshBar();
    refreshTabs();
  }

  function refreshNotice() {
    if (!scanned) return;
    const reading = state.reading;
    if (source.read) {
      replaceChildren(scanNotice, icon("texte"), el("div", {},
        el("strong", {}, "Texte lu sur une image."),
        el("p", {}, "Les mots mal lus sont listés à part. Relisez le document."),
      ));
      return;
    }
    if (reading) {
      const elapsed = (Date.now() - reading.started) / 1000;
      const remaining = reading.done ? elapsed / reading.done * (reading.total - reading.done) : reading.total * secondsPerPage;
      replaceChildren(scanNotice, icon("texte"), el("div", {},
        el("strong", {}, "Lecture du texte…"),
        el("p", {}, `Page ${Math.min(reading.done + 1, reading.total)} sur ${reading.total} · ${duration(remaining)}`),
        el("progress", { max: String(reading.total), value: String(reading.done), "aria-label": "Avancement de la lecture" }),
        el("button", { class: "lien", type: "button", click: () => actions.stopReading() }, "Arrêter"),
      ));
      return;
    }
    const estimate = (source.diagnostic?.pages ?? 1) * secondsPerPage;
    replaceChildren(scanNotice, icon("rectangle"), el("div", {},
      el("strong", {}, "Ce PDF est une image."),
      el("p", {}, "L'outil peut lire son texte, moins sûrement qu'un PDF classique : vérifiez tout."),
      el("div", { class: "lire" },
        el("button", { class: "bouton principal", type: "button", click: () => actions.readScan() }, "Lire le texte"),
        estimate >= 60 && el("span", {}, duration(estimate)),
      ),
      el("p", { class: "ou" }, "Ou tracez vous-même un rectangle sur ce qu'il faut effacer."),
    ));
  }

  function refreshTabs() {
    replaceChildren(tabItems, `À effacer · ${selectedItems(state).length + zoneCount(state) + state.removedImages.length}`);
    tabItems.setAttribute("aria-selected", String(session.view === "elements"));
    tabPreview.setAttribute("aria-selected", String(session.view === "apercu"));
  }

  function refreshRenderingButtons() {
    copyToggle.setAttribute("aria-pressed", String(session.rendering === "resultat"));
  }

  function refreshDrawing() {
    for (const button of toolButtons) button.setAttribute("aria-pressed", String(button.dataset.outil === currentTool()));
    preview.classList.toggle("dessin", session.drawing);
  }

  function refreshBar() {
    const count = selectedItems(state).length + zoneCount(state) + state.removedImages.length;
    replaceChildren(counter, el("strong", {}, String(count)), el("span", {}, "à effacer"));
    undoButton.disabled = !state.past.length;
    redoButton.disabled = !state.future.length;
    createButton.disabled = count === 0;
  }

  function refreshList() {
    if (isScan) return;
    refreshSearch();
    if (!state.items.length) {
      replaceChildren(list, el("p", { class: "vide" }, "Rien de détecté. Sélectionnez dans le document ce qu'il faut effacer."));
      return;
    }
    const items = state.items;
    const groups = categoryOrder
      .map((category) => ({ category, items: items.filter((item) => item.category === category).sort((a, b) => b.occurrences.length - a.occurrences.length) }))
      .filter((group) => group.items.length);
    replaceChildren(list,
      ...groups.map((group) => renderGroup(group.category, group.items)),
    );
  }

  function renderGroup(category: Category, items: Item[]) {
    const keys = items.map((item) => item.key);
    const chosen = keys.filter((key) => state.selected.has(key)).length;
    const bulk: [string, () => void][] = [];
    if (chosen < items.length) bulk.push(["Tout effacer", () => mutate(() => choose(state, keys, true))]);
    if (chosen > 0) bulk.push(["Tout garder", () => mutate(() => choose(state, keys, false))]);
    const group = el("details", { class: ["groupe", category, chosen === 0 && "garde"].filter(Boolean).join(" "), open: session.open.has(category), toggle: () => {
      if (group.open) session.open.add(category);
      else session.open.delete(category);
    } },
      el("summary", {},
        el("span", { class: "nom" }, categoryLabels[category]),
        el("span", { class: "compte" }, chosen === items.length ? String(chosen) : `${chosen} sur ${items.length}`),
      ),
      el("div", { class: "actions-groupe" }, ...bulk.map(([label, run]) => el("button", { class: "lien", type: "button", click: run }, label))),
      ...items.map(renderRow),
    );
    return group;
  }

  function renderRow(item: Item) {
    const selected = state.selected.has(item.key);
    const open = session.focused === item.key;
    const status = item.category === "mot" ? originNames[item.origin] : state.decided.has(item.key) ? "votre choix" : originNames[item.origin];
    const row = el("div", { class: ["ligne", removable(item) && "retirable", selected && "cochee", open && "ouverte"].filter(Boolean).join(" "), "data-cle": item.key });
    row.append(el("label", { class: "case" },
      el("input", { type: "checkbox", checked: selected, "aria-label": `Effacer ${item.value}`, change: () => mutate(() => choose(state, [item.key], !selected), item.key) }),
    ));
    row.append(el("button", { class: "corps", type: "button", "aria-expanded": String(open), click: () => focusItem(item) },
      el("span", { class: "valeur" }, item.value),
      el("span", { class: "meta" }, [`${item.occurrences.length} fois`, status].join(" · ")),
    ));
    if (removable(item)) row.append(el("button", { class: "retirer", type: "button", title: "Retirer de la liste", "aria-label": `Retirer ${item.value} de la liste`, click: () => forget(item) }, "×"));
    if (open) row.append(renderDetail(item));
    return row;
  }

  function removable(item: Item): boolean {
    return item.category === "mot" || item.category === "personne";
  }

  function forget(item: Item) {
    mutate(() => item.category === "mot" ? removeWord(state, item.value) : dismissItem(state, item.key));
    if (isPdf) actions.syncLocated().then(refresh);
    actions.notify(`« ${item.value} » retiré de la liste.`);
  }

  function renderDetail(item: Item) {
    const total = previewOccurrences(item);
    const index = session.focused === item.key ? session.occurrence % Math.max(1, item.occurrences.length) : 0;
    const occurrence = item.occurrences[index]!;
    const text = source.text;
    const before = text.slice(Math.max(0, occurrence.start - 40), occurrence.start).replace(/\s+/g, " ");
    const after = text.slice(occurrence.end, occurrence.end + 40).replace(/\s+/g, " ");
    return el("div", { class: "detail" },
      el("p", { class: "contexte" }, `…${before}`, el("mark", {}, item.value), `${after}…`),
      total > 0 && el("div", { class: "decision" },
        wide.matches && total > 1
          ? el("button", { class: "lien", type: "button", click: () => focusItem(item) }, `Suivant (${(index % total) + 1}/${total})`)
          : el("button", { class: "lien", type: "button", click: () => showOccurrence(item, session.focused === item.key ? session.occurrence : 0) }, "Voir dans le document"),
      ),
    );
  }

  function focusItem(item: Item) {
    if (session.focused === item.key) session.occurrence++;
    else {
      session.focused = item.key;
      session.occurrence = 0;
    }
    const before = rowTop(item.key);
    refreshList();
    if (before !== null) keepAnchor(item.key, before);
    if (wide.matches) showOccurrence(item, session.occurrence);
  }

  function previewOccurrences(item: Item): number {
    return preview.querySelectorAll(`[data-cle="${CSS.escape(item.key)}"]:not(.suite)`).length;
  }

  function showOccurrence(item: Item, index: number) {
    const targets = [...preview.querySelectorAll<HTMLElement>(`[data-cle="${CSS.escape(item.key)}"]:not(.suite)`)];
    if (!targets.length) return;
    if (session.focused !== item.key) {
      session.focused = item.key;
      session.occurrence = index;
    }
    const target = targets[index % targets.length]!;
    if (!wide.matches) switchView("apercu");
    target.scrollIntoView({ block: "center", behavior: prefersCalm() ? "auto" : "smooth" });
    for (const other of preview.querySelectorAll(".repere")) other.classList.remove("repere");
    target.classList.add("repere");
    window.setTimeout(() => target.classList.remove("repere"), 1800);
  }

  function toggleFromPreview(item: Item) {
    if (selectedText()) return;
    const remove = !state.selected.has(item.key);
    session.open.add(item.category);
    mutate(() => choose(state, [item.key], remove));
    if (wide.matches) revealRow(item.key);
  }

  function revealRow(key: string) {
    const row = list.querySelector<HTMLElement>(`[data-cle="${CSS.escape(key)}"]`);
    const scroller = list.closest<HTMLElement>(".panneau");
    if (!row || !scroller) return;
    const rowBox = row.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    if (rowBox.top < box.top || rowBox.bottom > box.bottom) scroller.scrollTop += rowBox.top - box.top - box.height / 3;
    row.classList.add("repere");
    window.setTimeout(() => row.classList.remove("repere"), 1800);
  }

  function rowTop(key: string): number | null {
    return list.querySelector(`[data-cle="${CSS.escape(key)}"]`)?.getBoundingClientRect().top ?? null;
  }

  function keepAnchor(key: string, before: number) {
    const after = rowTop(key);
    if (after === null || after === before) return;
    const scroller = list.closest<HTMLElement>(".panneau");
    if (wide.matches && scroller && scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop += after - before;
    else window.scrollBy({ top: after - before, behavior: "instant" });
  }

  function removeZone(page: number, index: number) {
    mutate(() => { state.zones[page]!.splice(index, 1); });
  }

  function refreshZones() {
    if (!isPdf) return;
    const zones = Object.entries(state.zones).flatMap(([page, rects]) => rects.map((rect, index) => ({ page: Number(page), index, rect }))).filter((zone) => !isImageZone(zone.page, zone.rect));
    if (!zones.length) {
      replaceChildren(zonesHolder);
      return;
    }
    const group = el("details", { class: "groupe", open: isScan || session.open.has("zones"), toggle: () => {
      if (group.open) session.open.add("zones");
      else session.open.delete("zones");
    } },
      el("summary", {}, el("span", { class: "nom" }, "Zones"), el("span", { class: "compte" }, String(zones.length))),
      el("ul", {}, ...zones.map((zone) => el("li", {},
        el("button", { class: "lien", type: "button", click: () => showZone(zone.page, zone.index) }, `Page ${zone.page + 1}, zone ${zone.index + 1}`),
        el("button", { class: "lien discret", type: "button", click: () => removeZone(zone.page, zone.index) }, "Enlever"),
      ))),
    );
    replaceChildren(zonesHolder, group);
  }

  function isImageZone(page: number, rect: Rect): boolean {
    return (source.diagnostic?.images ?? []).some((image) => image.page === page && sameRect(image.rect, rect));
  }

  function pdfImages() {
    return scanned ? [] : (source.diagnostic?.images ?? []).map((image, index) => ({
      key: `${image.page}:${index}`,
      page: image.page,
      rect: image.rect,
      chosen: (state.zones[image.page] ?? []).some((zone) => sameRect(zone, image.rect)),
    }));
  }

  function refreshImages() {
    const entries = isPdf
      ? pdfImages().map((image) => ({ key: image.key, label: `Page ${image.page + 1}`, chosen: image.chosen, thumbnail: pdfThumbnail(image.page, image.rect), flip: () => toggleImageZone(state, image.page, image.rect) }))
      : (source.inspection?.images ?? []).map((image, index) => ({ key: image.key, label: imageLabel(index, image.part, image.bytes), chosen: state.removedImages.includes(image.key), thumbnail: docxThumbnail(image.key), flip: () => toggleImageRemoval(state, image.key) }));
    if (!entries.length) {
      replaceChildren(imagesHolder);
      return;
    }
    const chosen = entries.filter((entry) => entry.chosen).length;
    const setAll = (wanted: boolean) => mutate(() => entries.filter((entry) => entry.chosen !== wanted).forEach((entry) => entry.flip()));
    const bulk: [string, () => void][] = [];
    if (chosen < entries.length) bulk.push(["Tout effacer", () => setAll(true)]);
    if (chosen > 0) bulk.push(["Tout garder", () => setAll(false)]);
    const group = el("details", { class: ["groupe", "images-groupe", chosen === 0 && "garde"].filter(Boolean).join(" "), open: session.open.has("images"), toggle: () => {
      if (group.open) session.open.add("images");
      else session.open.delete("images");
    } },
      el("summary", {},
        el("span", { class: "nom" }, "Images"),
        el("span", { class: "compte" }, chosen === entries.length ? String(chosen) : `${chosen} sur ${entries.length}`),
      ),
      el("div", { class: "actions-groupe" }, ...bulk.map(([label, run]) => el("button", { class: "lien", type: "button", click: run }, label))),
      ...entries.map((entry, index) => el("label", { class: ["ligne", "ligne-image", entry.chosen && "cochee"].filter(Boolean).join(" ") },
        el("span", { class: "case" }, el("input", { type: "checkbox", checked: entry.chosen, "aria-label": `Effacer l'image ${index + 1}`, change: () => mutate(entry.flip) })),
        entry.thumbnail,
        el("span", { class: "corps" }, el("span", { class: "valeur" }, `Image ${index + 1}`), el("span", { class: "meta" }, entry.label)),
      )),
    );
    replaceChildren(imagesHolder, group);
  }

  function imageLabel(index: number, part: string, bytes: number): string {
    const where = /header/.test(part) ? "en-tête" : /footer/.test(part) ? "pied de page" : /note/.test(part) ? "notes" : "document";
    const size = bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1e3))} Ko`;
    return `${where} · ${size}`;
  }

  function pdfThumbnail(pageIndex: number, rect: Rect) {
    const box = el("span", { class: "vignette", "aria-hidden": "true" });
    const page = state.pages[pageIndex];
    const size = source.diagnostic?.pageSizes[pageIndex];
    if (!page || !size) return box;
    const [x0, y0, x1, y1] = rect;
    const width = (x1 - x0) / size[0];
    const height = (y1 - y0) / size[1];
    if (width <= 0 || height <= 0) return box;
    box.style.backgroundImage = `url("${page.url}")`;
    box.style.backgroundSize = `${100 / width}% ${100 / height}%`;
    box.style.backgroundPosition = `${width >= 1 ? 0 : (x0 / size[0] / (1 - width)) * 100}% ${height >= 1 ? 0 : (y0 / size[1] / (1 - height)) * 100}%`;
    return box;
  }

  function docxThumbnail(key: string) {
    const box = el("span", { class: "vignette", "aria-hidden": "true" });
    actions.imageUrl(key).then((url) => { if (url) box.style.backgroundImage = `url("${url}")`; }).catch(() => undefined);
    return box;
  }

  function showZone(page: number, index: number) {
    const target = preview.querySelector<HTMLElement>(`[data-zone="${page}-${index}"]`);
    if (!target) return;
    if (!wide.matches) switchView("apercu");
    target.scrollIntoView({ block: "center", behavior: prefersCalm() ? "auto" : "smooth" });
  }

  function refreshPreview() {
    clearTap();
    if (isPdf && !session.reading) refreshPdfPreview();
    else replaceChildren(preview, source.inspection ? renderWordPreview() : renderTextPreview(), bubble);
  }

  function renderTextPreview() {
    const text = source.text;
    const labels = labelsFor(selectedItems(state));
    const byKey = new Map(state.items.map((item) => [item.key, item]));
    const sheet = el("div", { class: isPdf ? "feuille texte lecture" : "feuille texte" });
    let page = 1;
    if (isPdf) sheet.append(pageBreak(page));
    for (const segment of previewSegments(text, state.items, state.selected, labels)) {
      const piece = text.slice(segment.start, segment.end);
      const item = segment.key ? byKey.get(segment.key) : undefined;
      if (!item) {
        piece.split("\f").forEach((part, index) => {
          if (index > 0) sheet.append(pageBreak(++page));
          sheet.append(part);
        });
        continue;
      }
      sheet.append(markFor(item, segment, piece, segment.first, true));
    }
    return sheet;
  }

  function markFor(item: Item, segment: Segment, piece: string, first: boolean, withLabel: boolean) {
    const selected = segment.status === "retire";
    return el("mark", {
      class: `${segment.status}${first ? "" : " suite"}`,
      "data-cle": item.key,
      title: `${categoryNames[item.category]} · ${selected ? "effacé" : "gardé"}`,
      click: () => toggleFromPreview(item),
    }, el("span", { class: "original" }, piece), selected && withLabel && el("span", { class: "etiquette" }, segment.label));
  }

  function renderWordPreview() {
    const layout = source.inspection!.layout;
    const segments = previewSegments(source.text, state.items, state.selected, labelsFor(selectedItems(state)));
    const byKey = new Map(state.items.map((item) => [item.key, item]));
    const renderBlock = (block: DocxBlock): HTMLElement => block.kind === "paragraphe"
      ? renderParagraph(block, segments, byKey)
      : el("table", { class: "tableau-word" }, el("tbody", {}, ...block.rows.map((row) => el("tr", {}, ...row.map((cell) => el("td", {}, ...cell.map(renderBlock)))))));
    const part = (blocks: DocxBlock[], className: string) => blocks.length ? el("div", { class: className }, ...blocks.map(renderBlock)) : null;
    return el("div", { class: "feuille texte word" },
      part(layout.headers, "entete-word"),
      ...layout.body.map(renderBlock),
      part(layout.footers, "pied-word"),
      part(layout.notes, "notes-word"),
    );
  }

  function renderParagraph(paragraph: DocxParagraph, segments: Segment[], byKey: Map<string, Item>) {
    const classes = [paragraph.heading && `titre-word t${paragraph.heading}`, paragraph.list !== null && "liste-word"].filter(Boolean).join(" ");
    const element = el("p", { class: classes });
    const align = alignments[paragraph.align ?? ""];
    if (align) element.style.textAlign = align;
    if (paragraph.list !== null) element.style.paddingLeft = `${1.25 + paragraph.list * 1.25}em`;
    let cursor = paragraph.start;
    for (const run of paragraph.runs) {
      const span = styledRun(run);
      appendPieces(span, cursor, cursor + run.text.length, segments, byKey);
      cursor += run.text.length;
      element.append(span);
    }
    for (const image of paragraph.images) element.append(placedImage(image));
    return element;
  }

  function placedImage(image: DocxPlacedImage) {
    const index = (source.inspection?.images ?? []).findIndex((known) => known.key === image.key);
    if (index < 0) return el("span", {});
    const removed = state.removedImages.includes(image.key);
    const picture = el("img", { alt: `Image ${index + 1}`, draggable: "false" });
    const frame = el("button", {
      class: ["image-word", removed && "retiree"].filter(Boolean).join(" "),
      type: "button",
      title: removed ? "Image retirée de la copie, cliquer pour la garder" : "Cliquer pour retirer cette image de la copie",
      "aria-pressed": String(removed),
      click: () => mutate(() => toggleImageRemoval(state, image.key)),
    }, picture, el("span", { class: "legende-image" }, icon("image"), `Image ${index + 1}`));
    if (image.width > 0 && image.height > 0) {
      frame.style.width = `${Math.min(image.width, 640)}px`;
      frame.style.aspectRatio = `${image.width} / ${image.height}`;
    }
    actions.imageUrl(image.key).then((url) => { if (url) picture.src = url; }).catch(() => undefined);
    return frame;
  }

  function appendPieces(target: HTMLElement, from: number, to: number, segments: Segment[], byKey: Map<string, Item>) {
    let low = 0;
    let high = segments.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (segments[middle]!.end <= from) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < segments.length && segments[index]!.start < to; index++) {
      const segment = segments[index]!;
      const start = Math.max(from, segment.start);
      const piece = source.text.slice(start, Math.min(to, segment.end));
      const item = segment.key ? byKey.get(segment.key) : undefined;
      if (!item) target.append(piece);
      else target.append(markFor(item, segment, piece, segment.first && start === segment.start, start === segment.start));
    }
  }

  function styledRun(run: DocxRun) {
    const span = el("span", {});
    if (run.bold) span.style.fontWeight = "700";
    if (run.italic) span.style.fontStyle = "italic";
    const lines = [run.underline && "underline", run.strike && "line-through"].filter(Boolean).join(" ");
    if (lines) span.style.textDecorationLine = lines;
    if (run.color && !isPale(run.color)) span.style.color = `#${run.color}`;
    if (run.size) span.style.fontSize = `${Math.min(28, Math.max(8, run.size))}pt`;
    if (run.highlight && run.highlight !== "none") span.style.backgroundColor = highlights[run.highlight] ?? highlights.yellow!;
    return span;
  }

  function pageBreak(page: number) {
    return el("span", { class: "saut-page", "aria-hidden": "true" }, `Page ${page}`);
  }

  function refreshPdfPreview() {
    if (!state.pages.length) {
      replaceChildren(preview, el("p", { class: "vide" }, "Préparation de l'aperçu…"), bubble);
      return;
    }
    if (preview.querySelectorAll(".page").length !== state.pages.length) {
      replaceChildren(preview, ...state.pages.map((page, index) => {
        const size = source.diagnostic!.pageSizes[index]!;
        const image = el("img", { src: page.url, width: page.width, height: page.height, alt: `Page ${index + 1}`, draggable: "false", dragstart: (event) => event.preventDefault() });
        const overlay = el("div", { class: "calque", "data-page": index });
        const container = el("div", { class: "page feuille" }, image, renderTextLayer(page.lines, size), overlay);
        enableDrawing(container, overlay, index, size);
        return el("figure", {}, container, el("figcaption", {}, `Page ${index + 1} sur ${state.pages.length}`));
      }), bubble);
      fitTextLayers();
    }
    const itemsByValue = new Map(state.items.map((item) => [item.value, item]));
    for (const overlay of preview.querySelectorAll<HTMLElement>(".calque")) {
      const index = Number(overlay.dataset.page);
      const size = source.diagnostic!.pageSizes[index]!;
      const marks: HTMLElement[] = [];
      for (const located of state.located) {
        if (located.page !== index) continue;
        const item = itemsByValue.get(located.value);
        if (!item) continue;
        const selected = state.selected.has(item.key);
        marks.push(positioned(el("button", {
          class: `surlignage ${selected ? "retire" : "conserve"} ${item.category}`,
          type: "button",
          "data-cle": item.key,
          title: `${categoryNames[item.category]} · ${selected ? "effacé" : "gardé"}`,
          "aria-label": `${item.value}, ${selected ? "effacé" : "gardé"}`,
          click: () => toggleFromPreview(item),
        }), located.rect, size));
      }
      marks.sort((a, b) => Number(a.classList.contains("retire")) - Number(b.classList.contains("retire")));
      (state.zones[index] ?? []).forEach((rect, zoneIndex) => marks.push(positioned(el("button", {
        class: "zone",
        type: "button",
        "data-zone": `${index}-${zoneIndex}`,
        title: "Enlever cette zone",
        "aria-label": `Enlever la zone ${zoneIndex + 1} de la page ${index + 1}`,
        click: () => removeZone(index, zoneIndex),
      }, el("span", { class: "croix", "aria-hidden": "true" }, "×")), rect, size)));
      overlay.replaceChildren(...marks);
    }
  }

  function renderTextLayer(lines: TextLine[], size: [number, number]) {
    const layer = el("div", { class: "texte-calque", "aria-hidden": "true" });
    for (const line of lines) {
      const span = el("span", {}, line.text);
      const [x0, y0, , y1] = line.rect;
      span.style.left = `${(x0 / size[0]) * 100}%`;
      span.style.top = `${(y0 / size[1]) * 100}%`;
      span.style.height = `${((y1 - y0) / size[1]) * 100}%`;
      span.style.fontSize = `${((y1 - y0) / size[0]) * 88}cqw`;
      span.dataset.largeur = String(((line.rect[2] - x0) / size[0]) * 100);
      layer.append(span);
    }
    return layer;
  }

  function fitTextLayers() {
    const spans = [...preview.querySelectorAll<HTMLElement>(".texte-calque span:not([data-ajuste])")];
    if (!spans.length) return;
    const measured = spans.map((span) => {
      const pageWidth = span.parentElement!.getBoundingClientRect().width;
      return { span, wanted: (Number(span.dataset.largeur) / 100) * pageWidth, natural: span.getBoundingClientRect().width };
    });
    for (const { span, wanted, natural } of measured) {
      if (!wanted || !natural) continue;
      span.style.transform = `scaleX(${wanted / natural})`;
      span.dataset.ajuste = "";
    }
  }

  function positioned(element: HTMLElement, rect: Rect, size: [number, number]) {
    element.style.left = `${(rect[0] / size[0]) * 100}%`;
    element.style.top = `${(rect[1] / size[1]) * 100}%`;
    element.style.width = `${((rect[2] - rect[0]) / size[0]) * 100}%`;
    element.style.height = `${((rect[3] - rect[1]) / size[1]) * 100}%`;
    return element;
  }

  function enableDrawing(container: HTMLElement, overlay: HTMLElement, pageIndex: number, size: [number, number]) {
    let start: { x: number; y: number; point: [number, number]; pointer: number } | null = null;
    let ghost: HTMLElement | null = null;
    const point = (event: PointerEvent): [number, number] => {
      const bounds = container.getBoundingClientRect();
      const x = Math.min(Math.max(0, event.clientX - bounds.left), bounds.width);
      const y = Math.min(Math.max(0, event.clientY - bounds.top), bounds.height);
      return [(x / bounds.width) * size[0], (y / bounds.height) * size[1]];
    };
    const box = (a: [number, number], b: [number, number]): Rect => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    container.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.pointerType !== "mouse" && !session.drawing) return;
      if (!session.drawing && (event.target as HTMLElement).closest(".texte-calque")) return;
      start = { x: event.clientX, y: event.clientY, point: point(event), pointer: event.pointerId };
    });
    container.addEventListener("pointermove", (event) => {
      if (!start) return;
      if (!ghost) {
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
        ghost = el("div", { class: "zone brouillon" });
        overlay.append(ghost);
        container.setPointerCapture(start.pointer);
      }
      positioned(ghost, box(start.point, point(event)), size);
    });
    const finish = (event: PointerEvent) => {
      if (!start) return;
      const origin = start.point;
      const dragged = Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 6;
      start = null;
      if (!ghost && !dragged) return;
      ghost?.remove();
      ghost = null;
      const rect = box(origin, point(event));
      if (rect[2] - rect[0] < 4 || rect[3] - rect[1] < 4) return;
      dismissCoach();
      mutate(() => { (state.zones[pageIndex] ??= []).push(rect); });
    };
    container.addEventListener("pointerup", finish);
    container.addEventListener("pointercancel", () => {
      start = null;
      ghost?.remove();
      ghost = null;
    });
  }

  active = { refresh, history, selection: refreshSelection, notice: refreshNotice };
  refreshNotice();
  watchSelection();
  refreshRenderingButtons();
  refreshDrawing();
  refresh();
  return section;
}
