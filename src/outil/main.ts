import "../../styles/outil.css";
import { categoryLabels, type Category } from "../rules";
import type { Replacement } from "../engine/docx";
import type { Actions } from "./actions";
import { cleanText } from "./apercu";
import { demoText } from "./demo";
import { el, icon, plural, replaceChildren } from "./dom";
import { renderDepot, renderProgress, renderResultat } from "./ecrans";
import { decodeTextFile, textExtension, textMime, type TextEncoding, type TextExtension } from "./fichiers-texte";
import { revokeTemporaryUrls } from "./liens";
import { outputFileName } from "./nom-fichier";
import { createScanReader, readingScaleFor, type ScanReader } from "./lecture-scan";
import { handleShortcut, refreshNotice, refreshReview, releaseReview, renderRelecture, resetReview } from "./relecture";
import { locateRead, pageBreak, widen, type ReadPage } from "./texte-lu";
import { analyse, createState, labelsFor, occurrenceCount, selectedItems, zoneCount, type ExportResult, type Item, type State, type Step } from "./state";
import type { Rect } from "../engine/types";
import { EngineClient } from "./worker-client";

const version = "0.1.0";
const previewWidth = 760;

const state: State = createState();
let client = new EngineClient();
const root = document.getElementById("app")!;
const engineStatus = document.getElementById("etat-moteur")!;
const busyLayer = document.getElementById("occupe")!;
const messages = document.getElementById("messages")!;

function watchEngine() {
  engineStatus.textContent = "Chargement…";
  const watched = client;
  const slowTimer = window.setTimeout(() => { if (client === watched) engineStatus.textContent = "Chargement du moteur (4 Mo)…"; }, 15000);
  watched.ready.then(
    () => { if (client === watched) engineStatus.textContent = "Prêt hors ligne"; },
    (error: Error) => {
      if (client !== watched) return;
      engineStatus.textContent = "Moteur indisponible";
      showError(error.message);
    },
  ).finally(() => window.clearTimeout(slowTimer));
}

const actions: Actions = { state, render, back, openFile, openText, syncLocated, produce, notify, imageUrl, readScan, stopReading };
let reader: ScanReader | null = null;
const imageUrls = new Map<string, Promise<string | null>>();

function imageUrl(key: string): Promise<string | null> {
  let pending = imageUrls.get(key);
  if (!pending) {
    pending = client.call<"docxImage">({ type: "docxImage", key }).then(({ bytes, media }) => bytes ? URL.createObjectURL(new Blob([bytes], { type: imageMime(media) })) : null);
    imageUrls.set(key, pending);
  }
  return pending;
}

function imageMime(media: string): string {
  const extension = media.slice(media.lastIndexOf(".") + 1).toLowerCase();
  return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml", emf: "image/emf", wmf: "image/wmf" }[extension] ?? "application/octet-stream";
}

async function forgetImageUrls() {
  for (const pending of imageUrls.values()) {
    const url = await pending.catch(() => null);
    if (url) URL.revokeObjectURL(url);
  }
  imageUrls.clear();
}

function render() {
  revokeTemporaryUrls();
  document.body.dataset.etape = state.step;
  const views = { depot: renderDepot, relecture: renderRelecture, resultat: renderResultat };
  replaceChildren(root, renderProgress(actions), views[state.step](actions));
}

function goTo(step: Step) {
  clearError();
  state.step = step;
  render();
  window.scrollTo({ top: 0 });
}

const steps: Step[] = ["depot", "relecture", "resultat"];

function advance(step: Step) {
  if (state.step !== step) history.pushState({ etape: step }, "");
  goTo(step);
}

function back(step: Step) {
  if (step === "depot" && !leaveReview()) return;
  const current = steps.indexOf(history.state?.etape ?? "depot");
  const target = steps.indexOf(step);
  if (current > target) history.go(target - current);
  else show(step);
}

function leaveReview() {
  return state.step !== "relecture" || !state.past.length || window.confirm("Changer de document ? Vos choix sur celui-ci seront oubliés.");
}

function show(step: Step) {
  if (step === state.step) return;
  if (step === "depot") newDocument();
  else if (step === "relecture" && state.source) {
    state.result = null;
    goTo(step);
  } else if (step === "resultat" && state.result) goTo(step);
  else history.back();
}

window.addEventListener("popstate", (event) => {
  const step: Step = event.state?.etape ?? "depot";
  if (step === "depot" && !leaveReview()) {
    history.pushState({ etape: state.step }, "");
    return;
  }
  show(step);
});

function setBusy(message: string | null) {
  busyLayer.hidden = message === null;
  replaceChildren(busyLayer, message && el("div", { class: "carte-occupe", role: "status" }, el("span", { class: "roue", "aria-hidden": "true" }), message));
}

function showError(message: string) {
  replaceChildren(messages, el("div", { class: "alerte", role: "alert" }, icon("alerte"), el("p", {}, message), el("button", { class: "lien", type: "button", click: clearError }, "Fermer")));
}

function clearError() {
  replaceChildren(messages);
}

let noticeTimer = 0;

function notify(message: string) {
  replaceChildren(messages, el("div", { class: "annonce", role: "status" }, icon("valide"), el("p", {}, message)));
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(clearError, 3000);
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

async function openFile(file: File) {
  clearError();
  setBusy("Analyse du document…");
  try {
    const extension = textExtension(file.name);
    if (extension) {
      const { text, encoding } = decodeTextFile(await file.arrayBuffer());
      openText(text, file.name, extension, encoding);
      return;
    }
    await client.ready;
    const bytes = await file.arrayBuffer();
    const copy = new Uint8Array(bytes.slice(0));
    const { document } = await client.call<"opened">({ type: "open", bytes }, [bytes]);
    if (document.format === "pdf") {
      if (document.diagnostic.kind === "chiffre") throw new Error("Ce PDF est protégé par un mot de passe. Retirez la protection dans votre lecteur PDF, enregistrez, puis réessayez.");
      if (document.diagnostic.warnings.some((w) => w.includes("calques"))) throw new Error(document.diagnostic.warnings.join(" "));
      state.source = { format: "pdf", name: file.name, bytes: copy, text: document.diagnostic.pageTexts.join("\n\f"), diagnostic: document.diagnostic, inspection: null };
    } else {
      if (document.inspection.refusals.length) throw new Error(`Ce document Word contient : ${document.inspection.refusals.join(", ")}. Acceptez les révisions, supprimez les commentaires et les objets incorporés dans Word, enregistrez, puis réessayez.`);
      state.source = { format: "docx", name: file.name, bytes: copy, text: document.inspection.text, diagnostic: null, inspection: document.inspection };
    }
    prepareSource();
    await startReview();
  } catch (error) {
    showError(errorText(error));
  } finally {
    setBusy(null);
  }
}

function openText(text: string, name = "Texte collé", extension: TextExtension = "txt", encoding: TextEncoding = "utf-8") {
  clearError();
  if (!text.trim()) {
    showError("Le texte est vide : collez-le dans la zone avant de l'analyser.");
    return;
  }
  state.source = { format: "texte", textExtension: extension, textEncoding: encoding, name, bytes: null, text, diagnostic: null, inspection: null };
  prepareSource();
  startReview();
}

function prepareSource() {
  stopReading();
  state.words = [];
  state.items = [];
  state.selected = new Set();
  state.decided = new Set();
  state.zones = {};
  state.removedImages = [];
  forgetImageUrls();
  state.located = [];
  state.past = [];
  state.future = [];
  state.result = null;
  for (const page of state.pages) URL.revokeObjectURL(page.url);
  state.pages = [];
  analyse(state);
}

async function startReview() {
  const source = state.source!;
  resetReview();
  advance("relecture");
  if (source.format !== "pdf" || state.pages.length) return;
  setBusy("Préparation de l'aperçu…");
  try {
    await renderPages();
    await syncLocated();
  } catch (error) {
    showError(errorText(error));
  } finally {
    setBusy(null);
    refreshReview();
  }
}

async function renderPages() {
  const diagnostic = state.source!.diagnostic!;
  state.pages = [];
  for (let index = 0; index < diagnostic.pages; index++) {
    const scale = Math.min(2, previewWidth / diagnostic.pageSizes[index]![0]) * Math.min(2, window.devicePixelRatio || 1);
    const { png, width, height } = await client.call<"rendered">({ type: "render", page: index, scale });
    const { lines } = await client.call<"lines">({ type: "lines", page: index });
    state.pages.push({ url: URL.createObjectURL(new Blob([png], { type: "image/png" })), width, height, scale, lines });
  }
}

async function syncLocated() {
  if (state.source?.format !== "pdf") return;
  if (state.source.read) {
    state.located = locateRead(state.source.read, state.items);
    return;
  }
  const values = state.items.map((item) => item.value);
  const { located } = await client.call<"located">({ type: "locate", values });
  state.located = located;
}

async function produce(rasterizePages: number[] = []) {
  const source = state.source!;
  clearError();
  setBusy("Préparation de la copie…");
  try {
    const items = selectedItems(state);
    const labels = labelsFor(items);
    const targets = [...new Set(items.map((item) => item.value))];
    const counts = countByCategory(items);
    let result: ExportResult;
    if (source.format === "texte") {
      const output = cleanText(source.text, items, labels);
      const findings = targets.filter((target) => new RegExp(`(?<![\\p{L}\\p{N}])${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(output)).map((target) => `Le texte contient encore « ${target} ».`);
      const extension = source.textExtension ?? "txt";
      result = buildResult(new TextEncoder().encode(output), outputFileName(source.name, extension, items), textMime(extension), findings, counts, ["Étiquettes posées à la place des informations retirées.", source.textEncoding === "windows-1252" ? "Fichier d'origine lu en encodage Windows (ANSI), copie enregistrée en UTF-8." : "Copie encodée en UTF-8."], items);
      result.text = output;
    } else if (source.format === "docx") {
      const replacements: Replacement[] = items.map((item) => ({ find: item.value, label: labels.get(item.key)! }));
      const response = await client.call<"exported">({ type: "exportDocx", replacements, targets, removedImages: state.removedImages });
      const report = response.report as { propertiesBlanked: string[]; warnings: string[]; imagesRemoved: number };
      const extra = [`Propriétés du document vidées : ${report.propertiesBlanked.length ? [...new Set(report.propertiesBlanked)].join(", ") : "aucune n'était renseignée"}.`, "Descriptions d'images et image d'aperçu retirées."];
      if (report.imagesRemoved) extra.push(`${plural(report.imagesRemoved, "image retirée", "images retirées")}.`);
      if (report.warnings.length) extra.push(`Non traités, à relire dans Word : ${report.warnings.join(", ")}.`);
      result = buildResult(new Uint8Array(response.bytes), outputFileName(source.name, "docx", items), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", response.findings, counts, extra, items);
    } else {
      const mode = source.diagnostic!.kind === "scan" ? "image" : "texte";
      const readFromImage = Boolean(source.read);
      const rects = readFromImage ? readZones(items) : state.zones;
      const response = await client.call<"exported">({ type: "exportPdf", targets, rects, mode, rasterizePages });
      const report = response.report as { redactions: number; annotationsRemoved: number; rootKeysRemoved: string[]; masked: number; rasterizedPages: number[]; residualPages: number[] };
      const extra = mode === "image"
        ? [`Copie reconstruite en images, ${plural(report.masked, "zone noircie", "zones noircies")}. Le texte n'est plus sélectionnable.`]
        : [`${plural(report.redactions, "suppression")} dans le contenu des pages, dont ${plural(report.masked, "zone manuelle", "zones manuelles")}.`, `${plural(report.annotationsRemoved, "annotation retirée", "annotations retirées")}, structures cachées retirées : ${report.rootKeysRemoved.length ? report.rootKeysRemoved.join(", ") : "aucune"}.`, "Métadonnées vidées."];
      if (report.rasterizedPages.length) extra.push(`À votre demande, ${report.rasterizedPages.length > 1 ? "les pages" : "la page"} ${report.rasterizedPages.join(", ")} ${report.rasterizedPages.length > 1 ? "ont été reconstruites" : "a été reconstruite"} en image : zone noircie dans les pixels, texte non sélectionnable.`);
      if (source.diagnostic!.kind === "signe") extra.push("La signature électronique de l'original n'est pas conservée dans la copie.");
      result = buildResult(new Uint8Array(response.bytes), outputFileName(source.name, "pdf", items), "application/pdf", response.findings, counts, extra, items, readFromImage);
      result.residualPages = report.residualPages;
    }
    state.result = result;
    advance("resultat");
  } catch (error) {
    showError(errorText(error));
  } finally {
    setBusy(null);
  }
}

async function readScan() {
  const source = state.source;
  if (!source?.diagnostic || state.reading) return;
  clearError();
  const reading = { done: 0, total: source.diagnostic.pages, started: Date.now() };
  state.reading = reading;
  refreshNotice();
  const pages: ReadPage[] = [];
  try {
    reader = await createScanReader();
    for (let index = 0; index < reading.total && state.reading === reading; index++) {
      const scale = readingScaleFor(source.diagnostic.pageSizes[index] ?? [595, 842]);
      const { png } = await client.call<"rendered">({ type: "render", page: index, scale });
      pages.push(await reader.read(png, scale));
      reading.done = index + 1;
      refreshNotice();
    }
    if (state.reading !== reading) return;
    source.read = pages;
    source.text = pages.map((page) => page.text).join(pageBreak);
    pages.forEach((page, index) => { state.pages[index]!.lines = page.lines; });
    state.dismissed = [];
    analyse(state);
    await syncLocated();
  } catch (error) {
    if (state.reading === reading) showError(errorText(error));
  } finally {
    const finished = state.reading === reading;
    state.reading = null;
    await stopReader();
    if (finished) render();
    else refreshNotice();
  }
}

function stopReading() {
  state.reading = null;
  stopReader();
  refreshNotice();
}

async function stopReader() {
  const stopping = reader;
  reader = null;
  await stopping?.stop().catch(() => undefined);
}

function readZones(items: Item[]): Record<number, Rect[]> {
  const zones: Record<number, Rect[]> = structuredClone(state.zones);
  const values = new Set(items.map((item) => item.value));
  for (const located of state.located) {
    if (!values.has(located.value)) continue;
    (zones[located.page] ??= []).push(widen(located.rect));
  }
  return zones;
}

function countByCategory(items: Item[]): [Category, number][] {
  const counts = new Map<Category, number>();
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + item.occurrences.length);
  return [...counts.entries()];
}

function buildResult(bytes: Uint8Array, fileName: string, mime: string, findings: string[], counts: [Category, number][], extra: string[], items: Item[], readFromImage = false): ExportResult {
  const zones = zoneCount(state);
  const today = new Date().toISOString().slice(0, 10);
  const summary = [...counts.map(([category, count]) => `${categoryLabels[category]} : ${plural(count, "occurrence retirée", "occurrences retirées")}`), ...(zones ? [`Zones tracées : ${zones}`] : []), ...extra];
  const unread = "Texte lu sur une image : un mot mal lu n'est ni repéré ni contrôlé.";
  const checks = findings.length ? ["Contrôle de la copie : ÉCHEC, un contenu sélectionné subsiste.", ...findings] : readFromImage ? [unread] : ["Contrôle de la copie : aucun contenu sélectionné retrouvé dans les surfaces contrôlées (texte extrait, recherche, objets décodés, métadonnées, octets du fichier)."];
  const compteRendu = [`EffaceMesInfos ${version} — compte rendu du ${today}`, "", ...summary, "", ...checks, "", "Limites : le contrôle porte sur les informations sélectionnées. Une personne peut rester reconnaissable par le contexte. Ce compte rendu n'est pas une certification."].join("\n");
  return { bytes, fileName, mime, findings, summary: [...summary, checks[0]!], compteRendu, residualPages: [], removed: items.length, occurrences: occurrenceCount(items), zones, images: state.removedImages.length, text: null, pagesRead: readFromImage ? state.source!.read!.length : 0 };
}

function newDocument() {
  stopReading();
  client.terminate();
  client = new EngineClient();
  watchEngine();
  for (const page of state.pages) URL.revokeObjectURL(page.url);
  releaseReview();
  revokeTemporaryUrls();
  forgetImageUrls();
  Object.assign(state, createState());
  replaceChildren(root);
  goTo("depot");
  notify("Document précédent oublié.");
}

document.addEventListener("keydown", (event) => handleShortcut(event, state));
window.addEventListener("hashchange", openRequestedExample);

function openRequestedExample() {
  if (location.hash !== "#exemple") return;
  history.replaceState(null, "", location.pathname);
  openText(demoText, "Exemple fictif");
}

watchEngine();
render();
openRequestedExample();
