/**
 * Media plumbing for messenger attachments.
 *
 * The bridge was text-only, which broke both directions of an image. A photo
 * sent to the bot arrived as `msg.photo` with no `msg.text`, so the transport's
 * text guard dropped it before authorization. An image the agent produced
 * reached the phone as a file path string, which is meaningless on a handset.
 *
 * This module holds the platform-independent rules (mime resolution, size caps,
 * photo-versus-document choice) so transports stay thin and the rules stay
 * testable without a network.
 */
import * as fs from "fs";
import * as path from "path";
import type { MediaSettings, OutgoingMedia } from "./types.js";

/** Telegram's Bot API refuses a bot upload larger than 5 MB. */
export const TELEGRAM_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/** Telegram accepts up to 50 MB, but only through sendDocument. */
export const TELEGRAM_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

/** Default ceiling for one inbound attachment, in bytes. */
export const DEFAULT_INBOUND_MAX_BYTES = 5 * 1024 * 1024;

/** Default cap on attachments taken from a single inbound message. */
export const DEFAULT_INBOUND_MAX_IMAGES = 4;

/** Default ceiling for a file the agent pushes to a messenger chat. */
export const DEFAULT_OUTBOUND_MAX_BYTES = TELEGRAM_DOCUMENT_MAX_BYTES;

/**
 * Formats Telegram renders as an inline photo. SVG and PDF are absent on
 * purpose. Telegram rejects them for `sendPhoto`, so those go out as a document
 * and still reach the user, just as a file card instead of a preview.
 */
const PHOTO_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/heic",
]);

const EXTENSION_MIMES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

/**
 * Resolve a media mime type from a file path, lowercased extension lookup.
 * Returns undefined for an unknown extension.
 */
export function mimeFromPath(filePath: string): string | undefined {
  return EXTENSION_MIMES[path.extname(filePath).toLowerCase()];
}

/**
 * True when a messenger can show the mime type as an inline photo.
 */
export function isInlinePhotoMime(mimeType: string): boolean {
  return PHOTO_MIMES.has(mimeType.toLowerCase().split(";")[0].trim());
}

/**
 * Collapse the config block into concrete limits. Every field has a default, so
 * callers never deal with undefined.
 */
export function resolveMediaSettings(config?: MediaSettings): MediaSettings {
  return {
    enabled: config?.enabled !== false,
    maxBytes: positiveOr(config?.maxBytes, DEFAULT_INBOUND_MAX_BYTES),
    maxImages: positiveOr(config?.maxImages, DEFAULT_INBOUND_MAX_IMAGES),
    sendMaxBytes: positiveOr(config?.sendMaxBytes, DEFAULT_OUTBOUND_MAX_BYTES),
  };
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Render a byte count the way the error message reads it, KB below 1 MB.
 */
export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Read a local file into an outgoing attachment.
 *
 * Throws with a user-readable reason when the path is missing, is a directory,
 * or is larger than `maxBytes`. Callers surface the message to the model, which
 * is the audience that can act on it by compressing or picking another file.
 */
export function readOutgoingMedia(filePath: string, maxBytes: number): OutgoingMedia {
  const resolved = path.resolve(filePath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`File not found: ${resolved}`);
  }
  if (stat.isDirectory()) throw new Error(`Not a file: ${resolved}`);
  if (stat.size === 0) throw new Error(`File is empty: ${resolved}`);
  if (stat.size > maxBytes) {
    throw new Error(
      `File is ${formatBytes(stat.size)}, over the ${formatBytes(maxBytes)} messenger limit: ${resolved}`
    );
  }

  const mimeType = mimeFromPath(resolved) ?? "application/octet-stream";

  return {
    data: fs.readFileSync(resolved),
    mimeType,
    fileName: path.basename(resolved),
    caption: undefined,
  };
}

/**
 * Decide which Telegram call carries the file.
 *
 * `sendPhoto` gives an inline preview but only for the formats Telegram renders
 * and only under 5 MB. Everything else uses `sendDocument`, which handles any
 * mime type up to 50 MB and is the only route for SVG and PDF.
 */
export function sendMethodFor(mimeType: string, sizeBytes: number): "photo" | "document" {
  if (!isInlinePhotoMime(mimeType)) return "document";
  return sizeBytes <= TELEGRAM_UPLOAD_MAX_BYTES ? "photo" : "document";
}
