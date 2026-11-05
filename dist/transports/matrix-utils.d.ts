/**
 * Pure utility functions for Matrix transport.
 * Extracted for testability — no SDK or network dependencies.
 */
/** Escape HTML special characters */
export declare function escapeHtml(text: string): string;
/** Convert markdown to Matrix HTML. Returns plain body + optional formatted HTML. */
export declare function formatForMatrix(text: string): {
    body: string;
    formattedBody?: string;
};
/**
 * A media reference pulled out of a Matrix message event.
 *
 * Matrix stores a file in the media repository and points at it. An unencrypted
 * event carries `url` (an `mxc://` URI); an encrypted one carries a `file`
 * object holding the same URI plus the AES key and SHA-256 hash needed to
 * decrypt the download. Callers need both shapes, so both are surfaced.
 */
export interface MatrixMediaRef {
    /** `mxc://` URI for an unencrypted upload */
    mxc?: string;
    /** Encrypted file descriptor (key, hash, iv) for an E2EE upload */
    file?: any;
    mimeType: string;
    fileName?: string;
    size?: number;
}
/**
 * Extract an image reference from event content, or null when the event carries
 * no image worth downloading.
 *
 * Photos arrive as `m.image`. A picture sent as a file arrives as `m.file` with
 * an `image/*` mimetype, which is how Element sends a PNG or SVG that it chose
 * not to treat as a photo. Everything else (video, audio, arbitrary files) is
 * ignored because the model has no way to use it.
 */
export declare function mediaFromContent(content: any): MatrixMediaRef | null;
/**
 * Determine whether to skip a Matrix room event before processing.
 * Returns a reason string if the event should be skipped, or null if it should be processed.
 */
export declare function shouldSkipEvent(event: {
    sender?: string;
    origin_server_ts?: number;
    content?: any;
}, botUserId: string, connectedAt: number, joinedRooms: Set<string>, roomId: string): string | null;
/** Extract Matrix username (localpart) from a full MXID like @user:matrix.org */
export declare function extractUsername(userId: string): string;
/**
 * Check if bot was mentioned, matching either:
 *  - the full MXID `@user:server`
 *  - `@localpart` as a leading-@ word (avoids false-positives on bare names)
 */
export declare function wasBotMentioned(messageText: string, botUserId: string): boolean;
/** Strip bot mention from message text — symmetric with wasBotMentioned */
export declare function stripBotMention(text: string, botUserId: string): string;
//# sourceMappingURL=matrix-utils.d.ts.map