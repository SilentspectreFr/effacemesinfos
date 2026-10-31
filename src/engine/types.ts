import type * as Mupdf from "mupdf";

export type MupdfModule = typeof Mupdf;

export type Rect = [number, number, number, number];

export type PdfKind = "texte" | "scan" | "mixte" | "chiffre" | "signe";

export interface PdfDiagnostic {
  kind: PdfKind;
  pages: number;
  pageSizes: [number, number][];
  pageTexts: string[];
  textPages: number;
  imagePages: number;
  incoherent: boolean;
  warnings: string[];
  images: PdfImage[];
}

export interface PdfImage {
  page: number;
  rect: Rect;
}

export interface PdfReport {
  pages: number;
  redactions: number;
  annotationsRemoved: number;
  rootKeysRemoved: string[];
  masked: number;
  rasterizedPages: number[];
  residualPages: number[];
}

export interface TextLine {
  rect: Rect;
  text: string;
}

export interface Located {
  page: number;
  rect: Rect;
  value: string;
}
