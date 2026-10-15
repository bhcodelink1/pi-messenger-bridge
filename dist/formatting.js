/**
 * Extract text from assistant message.
 */
export function extractTextFromMessage(message) {
    const textParts = message.content.filter((part) => part.type === "text");
    return textParts.map((part) => part.text).join("\n");
}
/**
 * Check if assistant message contains tool calls (more turns will follow).
 */
export function hasToolCalls(message) {
    return message.content.some((part) => part.type === "toolCall");
}
/**
 * Format tool call summaries for the remote user.
 */
export function formatToolCalls(message) {
    const toolCalls = message.content.filter((part) => part.type === "toolCall");
    if (toolCalls.length === 0)
        return "";
    return toolCalls
        .map((tc) => {
        const name = tc.name || "tool";
        const args = tc.arguments || {};
        const argPairs = Object.entries(args)
            .map(([k, v]) => {
            const valStr = typeof v === 'string' ? v : JSON.stringify(v);
            return `${k}=${truncate(valStr, 50)}`;
        })
            .join(", ");
        // Wrap the tool name in backticks so messengers render it as inline
        // code — preserves snake_case readability across Telegram (which would
        // otherwise have to backslash-escape underscores), Discord, Slack,
        // Matrix, and WhatsApp uniformly.
        return argPairs ? `🔧 \`${name}\` (${argPairs})` : `🔧 \`${name}\``;
    })
        .join("\n");
}
/**
 * Truncate string to max length with ellipsis.
 */
export function truncate(str, maxLen) {
    if (!str)
        return "";
    if (str.length <= maxLen)
        return str;
    return str.substring(0, maxLen - 3) + "...";
}
/**
 * Split long messages into chunks, breaking at newlines when possible.
 */
export function splitMessage(text, maxLen) {
    if (text.length <= maxLen)
        return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            chunks.push(remaining);
            break;
        }
        let breakAt = remaining.lastIndexOf("\n", maxLen);
        if (breakAt < maxLen * 0.5) {
            breakAt = remaining.lastIndexOf(" ", maxLen);
        }
        if (breakAt < maxLen * 0.3) {
            breakAt = maxLen;
        }
        chunks.push(remaining.substring(0, breakAt));
        remaining = remaining.substring(breakAt).trimStart();
    }
    return chunks;
}
//# sourceMappingURL=formatting.js.map