export type TextExtension = "txt" | "md" | "markdown";

export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

export interface DecodedText {
  text: string;
  encoding: TextEncoding;
}

export function textExtension(name: string): TextExtension | null {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension === "txt" || extension === "md" || extension === "markdown" ? extension : null;
}

function byteOrderEncoding(data: Uint8Array): TextEncoding | null {
  if (data[0] === 0xff && data[1] === 0xfe) return "utf-16le";
  if (data[0] === 0xfe && data[1] === 0xff) return "utf-16be";
  return null;
}

function strictDecode(bytes: ArrayBuffer, encoding: TextEncoding): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeWithFallback(bytes: ArrayBuffer): DecodedText {
  const marked = byteOrderEncoding(new Uint8Array(bytes));
  if (marked) {
    const text = strictDecode(bytes, marked);
    if (text === null) throw new Error("Encodage non reconnu. Enregistrez ce fichier en UTF-8 dans votre éditeur de texte, puis réessayez.");
    return { text, encoding: marked };
  }
  const utf8 = strictDecode(bytes, "utf-8");
  if (utf8 !== null) return { text: utf8, encoding: "utf-8" };
  return { text: decodeWindows1252(new Uint8Array(bytes)), encoding: "windows-1252" };
}

const windows1252High = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

function decodeWindows1252(data: Uint8Array): string {
  let text = "";
  for (const byte of data) text += byte >= 0x80 && byte < 0xa0 ? windows1252High[byte - 0x80] : String.fromCharCode(byte);
  return text;
}

export function decodeTextFile(bytes: ArrayBuffer): DecodedText {
  const decoded = decodeWithFallback(bytes);
  if (/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/u.test(decoded.text)) {
    throw new Error("Ce fichier contient des données binaires ou des caractères de contrôle non pris en charge. Choisissez un fichier texte.");
  }
  if (!decoded.text.trim()) throw new Error("Ce fichier texte est vide. Choisissez un fichier contenant du texte.");
  return decoded;
}

export function textMime(extension: TextExtension = "txt"): string {
  return extension === "txt" ? "text/plain;charset=utf-8" : "text/markdown;charset=utf-8";
}
