import { extractTextFromMessage, formatToolCalls, hasToolCalls } from "./formatting.js";
const NO_REPLY = {
    target: null,
    text: "",
    sticky: false,
    clearPending: false,
    interim: false,
};
/**
 * Decide what a completed turn delivers.
 *
 * An in-flight remote request wins and keeps the existing behaviour: text plus
 * a tool call summary, and the request stays open while the turn spawned more
 * tool calls.
 *
 * When no request is in flight, the sticky target takes over. This covers the
 * case where pi answered a messenger request early ("the subagent is running")
 * and the real result arrives minutes later in a turn the bridge never saw a
 * message for, such as an OptChat subagent report. Sticky replies carry the
 * assistant text only. Tool call summaries are left out on purpose, so a
 * session driven from the terminal does not spam the last messenger chat with
 * `🔧 tool (...)` lines.
 *
 * `interimMessages` controls the chatter between the question and the answer.
 * A turn that ends in a tool call is by definition not the answer, and on a
 * long research run each such turn was a phone notification carrying a
 * half-thought. `"all"` keeps that behaviour. `"first"` lets one short
 * acknowledgement through per request, which is what a pre-spawn "looking into
 * it" line needs, and silences the rest. `"off"` sends nothing until a turn
 * finishes without tool calls. A turn with no tool calls is the final answer
 * and always sends, whatever the setting.
 */
export function planTurnReply(input) {
    const { message, pendingRemoteChat, stickyRemoteChat, config } = input;
    const mode = config.interimMessages ?? "all";
    const toolTurn = hasToolCalls(message);
    const responseText = extractTextFromMessage(message).trim();
    const toolCallsText = formatToolCalls(message);
    const showToolCalls = toolCallsText !== "" && !config.hideToolCalls;
    if (pendingRemoteChat) {
        // A turn that spawned more work is narration, not the answer. Under "first"
        // it may go once, under "off" never.
        const allowProse = mode === "all" || (!toolTurn || (mode === "first" && input.interimSent !== true));
        const parts = [];
        if (responseText !== "" && allowProse)
            parts.push(responseText);
        if (showToolCalls && allowProse)
            parts.push(toolCallsText);
        // Nothing to send this turn: leave the pending request untouched so a
        // later turn can still deliver the answer.
        if (parts.length === 0)
            return NO_REPLY;
        return {
            target: pendingRemoteChat,
            text: parts.join("\n\n"),
            sticky: false,
            clearPending: !toolTurn,
            interim: toolTurn && responseText !== "",
        };
    }
    if (config.stickyReplies === false)
        return NO_REPLY;
    if (!stickyRemoteChat || responseText === "")
        return NO_REPLY;
    // A tool-calling sticky turn is the terminal session narrating its work at a
    // phone. There is no request boundary to count "first" against, so anything
    // short of "all" drops it.
    if (toolTurn && mode !== "all")
        return NO_REPLY;
    return {
        target: stickyRemoteChat,
        text: responseText,
        sticky: true,
        clearPending: false,
        interim: toolTurn,
    };
}
//# sourceMappingURL=reply-routing.js.map