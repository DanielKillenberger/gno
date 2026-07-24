const DANGEROUS_HTML_BLOCKS =
  /<(script|style|iframe|object|embed|form|svg|math|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const UNCLOSED_DANGEROUS_HTML_BLOCK =
  /<(?:script|style|iframe|object|embed|form|svg|math|head)\b[^>]*>[\s\S]*$/gi;
const HTML_COMMENTS = /<!--[\s\S]*?-->/g;
const HTML_TAGS = /<[^>]*>/g;
const HTML_BREAKS = /<(?:br|hr)\s*\/?>/gi;
const HTML_BLOCK_ENDS =
  /<\/(?:p|div|section|article|header|footer|li|tr|h[1-6])\s*>/gi;

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

const removeDangerousHtml = (value: string): string =>
  value
    .replace(DANGEROUS_HTML_BLOCKS, "")
    .replace(UNCLOSED_DANGEROUS_HTML_BLOCK, "");

export const sanitizeHtmlToText = (html: string): string =>
  removeDangerousHtml(
    decodeHtmlEntities(
      removeDangerousHtml(html)
        .replace(HTML_COMMENTS, "")
        .replace(HTML_BREAKS, "\n")
        .replace(HTML_BLOCK_ENDS, "\n")
        .replace(HTML_TAGS, "")
    )
  )
    .replace(HTML_TAGS, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, lines) => line || lines[index - 1])
    .join("\n")
    .trim();
