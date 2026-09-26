import type { DocxInspection, DocxReport, Replacement } from "../engine/docx";
import type { Located, PdfDiagnostic, PdfReport, Rect, TextLine } from "../engine/types";

export type OpenedDocument = { format: "pdf"; diagnostic: PdfDiagnostic } | { format: "docx"; inspection: DocxInspection };

export type WorkerRequest =
  | { id: number; type: "open"; bytes: ArrayBuffer }
  | { id: number; type: "render"; page: number; scale: number }
  | { id: number; type: "lines"; page: number }
  | { id: number; type: "locate"; values: string[] }
  | { id: number; type: "exportPdf"; targets: string[]; rects: Record<number, Rect[]>; mode: "texte" | "image"; rasterizePages?: number[] }
  | { id: number; type: "exportDocx"; replacements: Replacement[]; targets: string[]; removedImages: string[] }
  | { id: number; type: "docxImage"; key: string }
  | { id: number; type: "forget" };

export type WorkerResponse =
  | { id: 0; type: "ready" }
  | { id: number; type: "opened"; document: OpenedDocument }
  | { id: number; type: "rendered"; png: ArrayBuffer; width: number; height: number }
  | { id: number; type: "lines"; lines: TextLine[] }
  | { id: number; type: "located"; located: Located[] }
  | { id: number; type: "exported"; bytes: ArrayBuffer; report: PdfReport | DocxReport; findings: string[] }
  | { id: number; type: "docxImage"; bytes: ArrayBuffer | null; media: string }
  | { id: number; type: "forgotten" }
  | { id: number; type: "error"; message: string };
