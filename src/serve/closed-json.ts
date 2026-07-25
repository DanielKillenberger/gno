/** Bounded, content-free JSON request parsing for closed REST contracts. */

const DEFAULT_MAX_BYTES = 16 * 1024;

export type ClosedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; code: "VALIDATION"; error: string };

export const parseClosedJson = async (
  request: Request,
  maxBytes = DEFAULT_MAX_BYTES
): Promise<ClosedJsonResult> => {
  try {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return {
        ok: false,
        code: "VALIDATION",
        error: "JSON body exceeds the allowed size",
      };
    }
    const reader = request.body?.getReader();
    if (!reader) {
      return {
        ok: false,
        code: "VALIDATION",
        error: "Invalid JSON body",
      };
    }
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("JSON body exceeds the allowed size");
        return {
          ok: false,
          code: "VALIDATION",
          error: "JSON body exceeds the allowed size",
        };
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      code: "VALIDATION",
      error: "Invalid JSON body",
    };
  }
};
