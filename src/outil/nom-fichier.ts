import type { Item } from "./state";

const fallbackBase = "document";
const suffix = "-nettoye";
const forbidden = /[\\/:*?"<>|\u0000-\u001f]/gu;

const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr");

const digitsOf = (value: string) => value.replace(/\D/g, "");

function sensitiveTokens(items: Item[]) {
  const words = new Set<string>();
  const numbers: string[] = [];
  for (const item of items) {
    for (const token of item.value.split(/[^\p{L}\p{N}]+/u)) if (token.length >= 3 && /\p{L}/u.test(token)) words.add(normalize(token));
    const digits = digitsOf(item.value);
    if (digits.length >= 4) numbers.push(digits);
  }
  return { words, numbers };
}

function isSensitive(token: string, { words, numbers }: ReturnType<typeof sensitiveTokens>): boolean {
  if (words.has(normalize(token))) return true;
  if (!/^\d+$/.test(token) || token.length < 4) return false;
  return numbers.some((digits) => digits === token || (token.length >= 5 && digits.includes(token)));
}

export function baseName(name: string, extension: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || name.slice(dot + 1).toLowerCase() !== extension) return null;
  return name.slice(0, dot);
}

export function cleanBase(base: string, items: Item[]): string {
  const sensitive = sensitiveTokens(items);
  const parts = base.split(/([^\p{L}\p{N}]+)/u);
  const kept: string[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const token = parts[index]!;
    if (!token || isSensitive(token, sensitive)) continue;
    if (kept.length) kept.push(parts[index - 1] ?? "-");
    kept.push(token);
  }
  return kept.join("").replace(forbidden, "").trim();
}

export function outputFileName(name: string, extension: string, items: Item[]): string {
  const base = baseName(name, extension);
  const cleaned = base === null ? "" : cleanBase(base, items);
  return `${cleaned || fallbackBase}${suffix}.${extension}`;
}

export function safeFileName(input: string, extension: string): string {
  const withoutExtension = input.trim().replace(new RegExp(`\\.${extension}$`, "i"), "");
  const cleaned = withoutExtension.replace(forbidden, "").replace(/^\.+/, "").trim();
  return `${cleaned || fallbackBase + suffix}.${extension}`;
}
