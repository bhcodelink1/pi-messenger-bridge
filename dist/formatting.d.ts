import type { AssistantMessage } from "@earendil-works/pi-ai";
/**
 * Extract text from assistant message.
 */
export declare function extractTextFromMessage(message: AssistantMessage): string;
/**
 * Check if assistant message contains tool calls (more turns will follow).
 */
export declare function hasToolCalls(message: AssistantMessage): boolean;
/**
 * Format tool call summaries for the remote user.
 */
export declare function formatToolCalls(message: AssistantMessage): string;
/**
 * Truncate string to max length with ellipsis.
 */
export declare function truncate(str: string, maxLen: number): string;
/**
 * Split long messages into chunks, breaking at newlines when possible.
 */
export declare function splitMessage(text: string, maxLen: number): string[];
//# sourceMappingURL=formatting.d.ts.map