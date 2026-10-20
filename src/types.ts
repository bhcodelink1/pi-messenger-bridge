/**
 * External message received from a messenger transport
 */
export interface ExternalMessage {
  /** Unique chat/channel identifier */
  chatId: string;
  /** Transport type (telegram, whatsapp, etc) */
  transport: string;
  /** Message content/text */
  content: string;
  /** Sender username */
  username: string;
  /** Sender user ID */
  userId: string;
  /** Message timestamp */
  timestamp: Date;
  /** Unique message identifier */
  messageId: string;
  /** Is this a group/channel message? */
  isGroupChat: boolean;
  /** Was the bot mentioned? (for group chats) */
  wasMentioned?: boolean;
}

/**
 * Configuration for msg-bridge extension
 */
export interface MsgBridgeConfig {
  telegram?: {
    token: string;
  };
  whatsapp?: {
    authPath?: string;
  };
  slack?: {
    botToken: string;
    appToken: string;
  };
  discord?: {
    token: string;
  };
  matrix?: {
    homeserverUrl: string;
    accessToken: string;
    encryption?: boolean;
  };
  auth?: {
    trustedUsers?: string[];
    adminUserId?: string;
    channels?: Record<string, { enabled: boolean; mode: "all" | "mentions" | "trusted-only" }>;
  };
  hideToolCalls?: boolean;
  /**
   * Keep replying to the messenger chat a message last arrived from, even for
   * turns that turn did not trigger. Defaults to true; set it to false to only
   * answer the request currently in flight.
   *
   * This exists because pi can finish work after the turn that answered the
   * request. A background subagent report (OptChat), a scheduled job, or a
   * retried turn all run as their own turns, and without a sticky target their
   * answer exists only in the terminal session.
   *
   * Sticky replies send the assistant text only, never tool call summaries.
   */
  stickyReplies?: boolean;
  /**
   * How much to send between a remote question and its answer. Defaults to
   * `"all"`, which forwards the assistant text of every turn, including turns
   * that only decided on a next tool call.
   *
   * `"first"` sends the first such message for a request and nothing after it,
   * so a short "looking into it" line still arrives while a 30-tool-call
   * research run stops sending eight half-thoughts to a phone.
   *
   * `"off"` sends nothing until the turn that finishes the work.
   *
   * A turn that ends without calling a tool is a final answer and always
   * sends, whatever this is set to. Tool call summaries follow the same rule,
   * since they only appear on tool-calling turns anyway.
   */
  interimMessages?: "all" | "first" | "off";
  /** Show a typing indicator while pi works on a remote request (default true). */
  typingIndicator?: boolean;
  /**
   * How often to re-send the typing indicator, in milliseconds. Messengers
   * expire the indicator on their own (Telegram ~5s, WhatsApp 3s, Matrix and
   * Discord ~10s), so a long tool run needs refreshes. Clamped to 1000-20000;
   * 0 or negative means one-shot with no refresh timer. Defaults to 4000.
   */
  typingRefreshMs?: number;
  autoConnect?: boolean;
  showWidget?: boolean;
  debug?: boolean;
}

/**
 * Pending remote chat session tracking
 */
export interface PendingRemoteChat {
  chatId: string;
  transport: string;
  username: string;
  messageId: string;
}

/**
 * Transport connection status
 */
export interface TransportStatus {
  type: string;
  connected: boolean;
  error?: string;
}
