// Classification of workspace files by extension and content, shared by the host and runtime
// file explorers.

export const TEXT_MIME_TYPES: Record<string, string> = {
  ".json": "application/json",
};

export const BINARY_MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
};

export const DEFAULT_TEXT_MIME_TYPE = "text/plain";
export const FILE_TYPE_SAMPLE_BYTES = 8192;
export const FILE_EXPLORER_STREAM_CHUNK_BYTES = 256 * 1024;
export const MAX_EDITABLE_FILE_BYTES = 1024 * 1024;
export const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export function textMimeTypeForExtension(ext: string): string {
  return TEXT_MIME_TYPES[ext] ?? DEFAULT_TEXT_MIME_TYPE;
}

export function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  let suspicious = 0;
  for (let idx = 0; idx < buffer.length; idx += 1) {
    const byte = buffer[idx];
    if (byte === 0) {
      return true;
    }

    const isControl =
      byte < 32 &&
      byte !== 9 && // tab
      byte !== 10 && // newline
      byte !== 13; // carriage return

    if (isControl || byte === 127) {
      suspicious += 1;
    }
  }

  return suspicious / buffer.length > 0.3;
}

/** A sample can end inside a multi-byte character, so only a complete invalid sequence fails. */
export function isValidUtf8Prefix(buffer: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer, { stream: true });
    return true;
  } catch {
    return false;
  }
}

export function isValidUtf8(buffer: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}
