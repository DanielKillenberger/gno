interface HeaderValue {
  value: string;
  params: Record<string, string>;
}

type DecodeHeaderWords = (value: string) => string;

const decodeExtendedParameter = (value: string): string => {
  const encoded = /^[^']*'[^']*'(.*)$/.exec(value)?.[1] ?? value;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
};

export const parseParameterizedHeader = (
  raw: string | undefined,
  decodeHeaderWords: DecodeHeaderWords
): HeaderValue => {
  if (!raw) return { value: "", params: {} };
  const pieces = raw.match(/(?:[^;"']+|"[^"]*"|'[^']*')+/g) ?? [raw];
  const value = pieces[0]?.trim().toLowerCase() ?? "";
  const params: Record<string, string> = {};
  const continuations = new Map<
    string,
    Array<{ encoded: boolean; index: number; value: string }>
  >();
  for (const piece of pieces.slice(1)) {
    const separator = piece.indexOf("=");
    if (separator <= 0) continue;
    const key = piece.slice(0, separator).trim().toLowerCase();
    let parameter = piece.slice(separator + 1).trim();
    if (
      (parameter.startsWith('"') && parameter.endsWith('"')) ||
      (parameter.startsWith("'") && parameter.endsWith("'"))
    ) {
      parameter = parameter.slice(1, -1);
    }
    const continuation = /^(.+)\*(\d+)(\*)?$/.exec(key);
    if (continuation) {
      const base = continuation[1];
      const index = Number.parseInt(continuation[2] ?? "", 10);
      if (base && Number.isSafeInteger(index)) {
        const segments = continuations.get(base) ?? [];
        segments.push({
          encoded: Boolean(continuation[3]),
          index,
          value: parameter,
        });
        continuations.set(base, segments);
      }
      continue;
    }
    const decoded = key.endsWith("*")
      ? decodeExtendedParameter(parameter)
      : parameter;
    params[key.replace(/\*$/, "")] = decodeHeaderWords(decoded);
  }
  for (const [key, unsorted] of continuations) {
    const segments = unsorted.toSorted(
      (left, right) => left.index - right.index
    );
    if (
      segments[0]?.index !== 0 ||
      segments.some((segment, index) => segment.index !== index)
    ) {
      continue;
    }
    const joined = segments.map((segment) => segment.value).join("");
    const decoded = segments.some((segment) => segment.encoded)
      ? decodeExtendedParameter(joined)
      : joined;
    params[key] = decodeHeaderWords(decoded);
  }
  return { value, params };
};
