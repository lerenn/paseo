/** Maps the workspace root between the daemon's filesystem and a runtime's. */
export interface PathMap {
  host: string;
  runtime: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A path as it appears inside a JSON string. */
function jsonEscaped(path: string): string {
  return JSON.stringify(path).slice(1, -1);
}

/**
 * Rewrites every occurrence of the `from` path in `text`, keeping the part after it. A match
 * stands alone: `/work/ws` does not match `/work/ws2` or `/other/work/ws`.
 */
export function rewritePathPrefix(text: string, from: string, to: string): string {
  return from === to ? text : rewriteEscaped(text, from, to);
}

function rewriteEscaped(text: string, from: string, to: string): string {
  const plain = new RegExp(`(?<![A-Za-z0-9_.\\-])${escapeRegExp(from)}(?![A-Za-z0-9_.\\-])`, "g");
  let result = text.replace(plain, () => to);
  const escapedFrom = jsonEscaped(from);
  if (escapedFrom !== from) {
    const escaped = new RegExp(
      `(?<![A-Za-z0-9_.\\-])${escapeRegExp(escapedFrom)}(?![A-Za-z0-9_.\\-])`,
      "g",
    );
    const escapedTo = jsonEscaped(to);
    result = result.replace(escaped, () => escapedTo);
  }
  return result;
}

export function toRuntimePaths(text: string, map: PathMap | null): string {
  return map ? rewritePathPrefix(text, map.host, map.runtime) : text;
}

export function toHostPaths(text: string, map: PathMap | null): string {
  return map ? rewritePathPrefix(text, map.runtime, map.host) : text;
}

/**
 * Rewrites paths in a byte stream one line at a time. Provider protocols are line-delimited
 * (JSONL, NDJSON), so a line is the smallest unit a path can be split across chunks within.
 */
export function createLineRewriter(rewrite: (line: string) => string): {
  push(chunk: Uint8Array): Uint8Array[];
  flush(): Uint8Array[];
} {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  return {
    push(chunk) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      return lines.map((line) => encoder.encode(`${rewrite(line)}\n`));
    },
    flush() {
      const rest = pending + decoder.decode();
      pending = "";
      return rest ? [encoder.encode(rewrite(rest))] : [];
    },
  };
}
