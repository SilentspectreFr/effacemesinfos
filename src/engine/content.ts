const delimiters = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);
const whitespace = /\s/;

interface Token {
  text: string;
  operator: boolean;
  start: number;
  end: number;
}

function readString(source: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const c = source[i]!;
    if (c === "\\") i += 2;
    else if (c === "(") { depth++; i++; }
    else if (c === ")") { depth--; i++; if (depth === 0) return i; }
    else i++;
  }
  return i;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const push = (text: string, operator: boolean, start: number, end: number) => tokens.push({ text, operator, start, end });
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (whitespace.test(c)) { i++; continue; }
    if (c === "%") { while (i < source.length && source[i] !== "\n" && source[i] !== "\r") i++; continue; }
    if (c === "(") { const end = readString(source, i); push(source.slice(i, end), false, i, end); i = end; continue; }
    if (c === "<") {
      if (source[i + 1] === "<") { push("<<", false, i, i + 2); i += 2; continue; }
      const end = source.indexOf(">", i);
      push(source.slice(i, end + 1), false, i, end + 1);
      i = end + 1;
      continue;
    }
    if (c === ">" && source[i + 1] === ">") { push(">>", false, i, i + 2); i += 2; continue; }
    if (c === "[" || c === "]" || c === "{" || c === "}") { push(c, false, i, i + 1); i++; continue; }
    if (c === "/") {
      let end = i + 1;
      while (end < source.length && !whitespace.test(source[end]!) && !delimiters.has(source[end]!)) end++;
      push(source.slice(i, end), false, i, end);
      i = end;
      continue;
    }
    let end = i;
    while (end < source.length && !whitespace.test(source[end]!) && !delimiters.has(source[end]!)) end++;
    const text = source.slice(i, end);
    const operator = !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text);
    push(text, operator, i, end);
    if (text === "ID" && operator) {
      const stop = source.indexOf("EI", end);
      const rawEnd = stop < 0 ? source.length : stop + 2;
      push(source.slice(end, rawEnd), false, end, rawEnd);
      i = stop < 0 ? source.length : stop + 2;
      continue;
    }
    i = end;
  }
  return tokens;
}

export function usesNextLineShowOperators(source: string): boolean {
  return tokenize(source).some((token) => token.operator && (token.text === "'" || token.text === "\""));
}

export function rewriteNextLineShowOperators(source: string): string {
  const output: string[] = [];
  let operands: string[] = [];
  for (const token of tokenize(source)) {
    if (!token.operator) { operands.push(token.text); continue; }
    if (token.text === "'") output.push("T*", ...operands, "Tj");
    else if (token.text === "\"" && operands.length >= 3) output.push(operands[operands.length - 3]!, "Tw", operands[operands.length - 2]!, "Tc", "T*", operands[operands.length - 1]!, "Tj");
    else output.push(...operands, token.text);
    operands = [];
  }
  output.push(...operands);
  return output.join("\n");
}

const captionKeys = new Set(["/Alt", "/ActualText", "/E"]);

function captionSpans(source: string): [number, number][] {
  const tokens = tokenize(source);
  const spans: [number, number][] = [];
  let depth = 0;
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k]!;
    if (token.text === "<<") depth++;
    else if (token.text === ">>") depth--;
    else if (depth > 0 && captionKeys.has(token.text) && k + 1 < tokens.length) {
      let last = k + 1;
      const opening = tokens[last]!.text;
      if (opening === "[" || opening === "<<") {
        const closing = opening === "[" ? "]" : ">>";
        let nesting = 0;
        for (; last < tokens.length; last++) {
          if (tokens[last]!.text === opening) nesting++;
          else if (tokens[last]!.text === closing && --nesting === 0) break;
        }
      }
      spans.push([token.start, tokens[Math.min(last, tokens.length - 1)]!.end]);
      k = last;
    }
  }
  return spans;
}

export function hasMarkedContentCaptions(source: string): boolean {
  return captionSpans(source).length > 0;
}

export function removeMarkedContentCaptions(source: string): string {
  let output = "";
  let from = 0;
  for (const [start, end] of captionSpans(source)) {
    output += source.slice(from, start);
    from = end;
  }
  return output + source.slice(from);
}
