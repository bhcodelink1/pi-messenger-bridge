import type { AssistantMessage } from "@earendil-works/pi-ai";
import { extractTextFromMessage, formatToolCalls, hasToolCalls } from "./formatting.js";
import type { MsgBridgeConfig, PendingRemoteChat } from "./types.js";

/**
 * What a finished turn should deliver, to whom, and what bookkeeping follows.
 *
 * The routing rules live here instead of in the `turn_end` handler so they can
 * be exercised without a live pi session, a transport, or a config file.
 */
export interface TurnReplyPlan {
  /** Where to deliver, or null when this turn has nothing to send. */
  target: PendingRemoteChat | null;
  /** Message body. Empty whenever `target` is null. */
  text: string;
  /** True when the send goes to the sticky target rather than an in-flight request. */
  sticky: boolean;
  /** Clear the in-flight request after a successful send (the turn finished it). */
  clearPending: boolean;
}

export interface TurnReplyInput {
  /** The assistant message that ended the turn. */
  message: AssistantMessage;
  /** Chat that asked and is still waiting, if any. */
  pendingRemoteChat: PendingRemoteChat | null;
  /** Last chat a message arrived from, kept so late turns still have somewhere to go. */
  stickyRemoteChat: PendingRemoteChat | null;
  config: MsgBridgeConfig;
}

const NO_REPLY: TurnReplyPlan = {
  target: null,
  text: "",
  sticky: false,
  clearPending: false,
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
 */
export function planTurnReply(input: TurnReplyInput): TurnReplyPlan {
  const { message, pendingRemoteChat, stickyRemoteChat, config } = input;

  const responseText = extractTextFromMessage(message).trim();
  const toolCallsText = formatToolCalls(message);
  const showToolCalls = toolCallsText !== "" && !config.hideToolCalls;

  if (pendingRemoteChat) {
    const parts: string[] = [];
    if (responseText !== "") parts.push(responseText);
    if (showToolCalls) parts.push(toolCallsText);

    // Nothing to send this turn: leave the pending request untouched so a
    // later turn can still deliver the answer.
    if (parts.length === 0) return NO_REPLY;

    return {
      target: pendingRemoteChat,
      text: parts.join("\n\n"),
      sticky: false,
      clearPending: !hasToolCalls(message),
    };
  }

  if (config.stickyReplies === false) return NO_REPLY;
  if (!stickyRemoteChat || responseText === "") return NO_REPLY;

  return {
    target: stickyRemoteChat,
    text: responseText,
    sticky: true,
    clearPending: false,
  };
}
