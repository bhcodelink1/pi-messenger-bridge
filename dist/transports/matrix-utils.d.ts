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