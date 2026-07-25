const DANGEROUS_HTML_ELEMENTS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "svg",
  "math",
  "head",
]);
const HTML_LINE_BREAK_ELEMENTS = new Set([
  "br",
  "hr",
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "li",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

const decodeHtmlEntities = (value: string): string => {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
    (_match, decimal: string, hexadecimal: string, name: string) => {
      const code = decimal
        ? Number.parseInt(decimal, 10)
        : hexadecimal
          ? Number.parseInt(hexadecimal, 16)
          : undefined;
      if (code !== undefined) {
        return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : "";
      }
      return named[name.toLowerCase()] ?? "";
    }
  );
};

const findTagEnd = (value: string, start: number): number => {
  let quote: '"' | "'" | undefined;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
};

interface ParsedHtmlTag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
}

const parseHtmlTag = (raw: string): ParsedHtmlTag | undefined => {
  const inner = raw.slice(1, -1).trim();
  const closing = inner.startsWith("/");
  const nameStart = closing ? 1 : 0;
  let nameEnd = nameStart;
  while (nameEnd < inner.length && /[a-z\d-]/i.test(inner[nameEnd] ?? "")) {
    nameEnd += 1;
  }
  if (nameEnd === nameStart) return undefined;
  return {
    name: inner.slice(nameStart, nameEnd).toLowerCase(),
    closing,
    selfClosing: inner.endsWith("/"),
  };
};

const embeddedDangerousTag = (
  raw: string
): Pick<ParsedHtmlTag, "name" | "closing"> | undefined => {
  const lower = raw.toLowerCase();
  for (const name of DANGEROUS_HTML_ELEMENTS) {
    for (const closing of [true, false]) {
      const marker = closing ? `</${name}` : `<${name}`;
      let offset = lower.indexOf(marker);
      while (offset >= 0) {
        const boundary = lower[offset + marker.length];
        if (!(boundary && /[a-z\d-]/.test(boundary))) {
          return { name, closing };
        }
        offset = lower.indexOf(marker, offset + 1);
      }
    }
  }
  return undefined;
};

const htmlToPlainText = (value: string): string => {
  const output: string[] = [];
  const suppressedElements: string[] = [];
  let index = 0;
  while (index < value.length) {
    if (value.startsWith("<!--", index)) {
      const commentEnd = value.indexOf("-->", index + 4);
      if (commentEnd < 0) break;
      index = commentEnd + 3;
      continue;
    }
    if (value[index] !== "<") {
      if (suppressedElements.length === 0) output.push(value[index] ?? "");
      index += 1;
      continue;
    }
    const tagEnd = findTagEnd(value, index);
    if (tagEnd < 0) break;
    const rawTag = value.slice(index, tagEnd + 1);
    const parsed = embeddedDangerousTag(rawTag) ?? parseHtmlTag(rawTag);
    if (parsed && DANGEROUS_HTML_ELEMENTS.has(parsed.name)) {
      if (parsed.closing) {
        const openIndex = suppressedElements.lastIndexOf(parsed.name);
        if (openIndex >= 0) suppressedElements.splice(openIndex, 1);
      } else if (!("selfClosing" in parsed && parsed.selfClosing)) {
        suppressedElements.push(parsed.name);
      }
    } else if (
      parsed &&
      suppressedElements.length === 0 &&
      HTML_LINE_BREAK_ELEMENTS.has(parsed.name) &&
      (parsed.closing || parsed.name === "br" || parsed.name === "hr")
    ) {
      output.push("\n");
    }
    index = tagEnd + 1;
  }
  return output.join("");
};

export const sanitizeHtmlToText = (html: string): string =>
  htmlToPlainText(decodeHtmlEntities(html))
    .replaceAll("\r", "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, lines) => line || lines[index - 1])
    .join("\n")
    .trim();
