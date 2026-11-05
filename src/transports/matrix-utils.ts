/**
 * Pure utility functions for Matrix transport.
 * Extracted for testability — no SDK or network dependencies.
 */

/** Escape HTML special characters */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert markdown to Matrix HTML. Returns plain body + optional formatted HTML. */
export function formatForMatrix(text: string): { body: string; formattedBody?: string } {
  const hasMarkdown = /[*_`#[]/.test(text);
  if (!hasMarkdown) {
    return { body: text };
  }

  let html = text;

  // Protect code blocks
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push(`<pre><code${lang ? ` class="language-${lang}"` : ""}>${escapeHtml(code.trimEnd())}</code></pre>`);
    return `__CODEBLOCK_${codeBlocks.length - 1}__`;
  });

  // Protect inline code
  const inlineCodes: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `__INLINECODE_${inlineCodes.length - 1}__`;
  });

  // Bold
  html = html.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  html = html.replace(/(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Newlines to <br>
  html = html.replace(/\n/g, "<br>");

  // Restore code blocks and inline code
  html = html.replace(/__CODEBLOCK_(\d+)__/g, (_, idx) => codeBlocks[parseInt(idx, 10)]);
  html = html.replace(/__INLINECODE_(\d+)__/g, (_, idx) => inlineCodes[parseInt(idx, 10)]);

  return { body: text, formattedBody: html };
}

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
export function mediaFromContent(content: any): MatrixMediaRef | null {
  if (!content?.msgtype) return null;

  const fileObj = content.file;
  const mxc = content.url ?? fileObj?.url;
  if (!mxc) return null;

  const mimeType: string = content.info?.mimetype ?? content.mimetype ?? "";
  const isImage =
    content.msgtype === "m.image" ||
    (content.msgtype === "m.file" && mimeType.startsWith("image/"));
  if (!isImage) return null;

  const fileName =
    content.filename ?? (typeof content.body === "string" ? content.body : undefined);

  return {
    mxc,
    file: fileObj ?? undefined,
    mimeType: mimeType || "image/jpeg",
    fileName,
    size: typeof content.info?.size === "number" ? content.info.size : undefined,
  };
}

/**
 * Determine whether to skip a Matrix room event before processing.
 * Returns a reason string if the event should be skipped, or null if it should be processed.
 */
export function shouldSkipEvent(
  event: { sender?: string; origin_server_ts?: number; content?: any },
  botUserId: string,
  connectedAt: number,
  joinedRooms: Set<string>,
  roomId: string
): string | null {
  // Ignore own messages
  if (event.sender === botUserId) return "own_message";

  // Skip events from before this connection (stale replay from initial sync)
  const eventTs = event.origin_server_ts || 0;
  if (eventTs < connectedAt) return "stale";

  // Text messages, and image messages that carry a file, are both processable.
  // An image used to fall through to "not_text" here, which meant a photo sent
  // to the bot produced no reply at all.
  const content = event.content;
  if (!content?.msgtype) return "not_text";
  const isText = content.msgtype === "m.text" && !!content.body;
  if (!isText && !mediaFromContent(content)) return "not_text";

  // Ignore edits (we only process original messages)
  if (content["m.new_content"]) return "edit";

  // Skip events from rooms we're not in (cached, no API call)
  if (!joinedRooms.has(roomId)) return "not_joined";

  return null;
}

/** Extract Matrix username (localpart) from a full MXID like @user:matrix.org */
export function extractUsername(userId: string): string {
  return userId.replace(/^@/, "").replace(/:.*$/, "");
}

/**
 * Check if bot was mentioned, matching either:
 *  - the full MXID `@user:server`
 *  - `@localpart` as a leading-@ word (avoids false-positives on bare names)
 */
export function wasBotMentioned(messageText: string, botUserId: string): boolean {
  if (messageText.includes(botUserId)) return true;
  const localpart = extractUsername(botUserId);
  if (!localpart) return false;
  const re = new RegExp(`@${escapeRegExp(localpart)}\\b`, "i");
  return re.test(messageText);
}

/** Strip bot mention from message text — symmetric with wasBotMentioned */
export function stripBotMention(text: string, botUserId: string): string {
  const localpart = extractUsername(botUserId);
  let out = text.replace(new RegExp(escapeRegExp(botUserId), "g"), "");
  if (localpart) {
    out = out.replace(new RegExp(`@${escapeRegExp(localpart)}\\b`, "gi"), "");
  }
  return out.trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
