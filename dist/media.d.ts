import type { MediaSettings, OutgoingMedia } from "./types.js";
/** Telegram's Bot API refuses a bot upload larger than 5 MB. */
export declare const TELEGRAM_UPLOAD_MAX_BYTES: number;
/** Telegram accepts up to 50 MB, but only through sendDocument. */
export declare const TELEGRAM_DOCUMENT_MAX_BYTES: number;
/** Default ceiling for one inbound attachment, in bytes. */
export declare const DEFAULT_INBOUND_MAX_BYTES: number;
/** Default cap on attachments taken from a single inbound message. */
export declare const DEFAULT_INBOUND_MAX_IMAGES = 4;
/** Default ceiling for a file the agent pushes to a messenger chat. */
export declare const DEFAULT_OUTBOUND_MAX_BYTES: number;
/**
 * Resolve a media mime type from a file path, lowercased extension lookup.
 * Returns undefined for an unknown extension.
 */
export declare function mimeFromPath(filePath: string): string | undefined;
/**
 * True when a messenger can show the mime type as an inline photo.
 */
export declare function isInlinePhotoMime(mimeType: string): boolean;
/**
 * Collapse the config block into concrete limits. Every field has a default, so
 * callers never deal with undefined.
 */
export declare function resolveMediaSettings(config?: MediaSettings): MediaSettings;
/**
 * Render a byte count the way the error message reads it, KB below 1 MB.
 */
export declare function formatBytes(bytes: number): string;
/**
 * Read a local file into an outgoing attachment.
 *
 * Throws with a user-readable reason when the path is missing, is a directory,
 * or is larger than `maxBytes`. Callers surface the message to the model, which
 * is the audience that can act on it by compressing or picking another file.
 */
export declare function readOutgoingMedia(filePath: string, maxBytes: number): OutgoingMedia;
/**
 * Decide which Telegram call carries the file.
 *
 * `sendPhoto` gives an inline preview but only for the formats Telegram renders
 * and only under 5 MB. Everything else uses `sendDocument`, which handles any
 * mime type up to 50 MB and is the only route for SVG and PDF.
 */
export declare function sendMethodFor(mimeType: string, sizeBytes: number): "photo" | "document";
//# sourceMappingURL=media.d.ts.map