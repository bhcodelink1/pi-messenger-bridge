import * as fs from "fs";
import type TelegramBot from "node-telegram-bot-api";
import * as os from "os";
import * as path from "path";
import { withDeadline } from "../async-util.js";
import type { ChallengeAuth } from "../auth/challenge-auth.js";
import {
  formatBytes,
  mimeFromPath,
  resolveMediaSettings,
  sendMethodFor,
} from "../media.js";
import type {
  ExternalMessage,
  MediaSettings,
  OutgoingMedia,
  RemoteAttachment,
} from "../types.js";
import type { ITransportProvider } from "./interface.js";

/** How long to wait for the first getUpdates before treating connect as done. */
const FIRST_POLL_TIMEOUT_MS = 2000;

/**
 * Telegram transport provider using node-telegram-bot-api
 */
export class TelegramProvider implements ITransportProvider {
  readonly type = "telegram";
  private bot?: TelegramBot;
  private _isConnected = false;
  private messageHandler?: (message: ExternalMessage) => void;
  private errorHandler?: (error: Error) => void;
  private lastProcessedMessageId = 0;

  constructor(
    private token: string,
    private auth: ChallengeAuth,
    private mediaSettings?: MediaSettings
  ) {}

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Convert standard markdown to Telegram MarkdownV1 format.
   *
   * Telegram MarkdownV1 syntax: *bold*, _italic_, `code`, ```pre```, [text](url).
   * Per docs, only `_ * [ \`` need backslash-escaping when literal — otherwise
   * a stray `_` (e.g. in a snake_case tool name like `hud_canvas`) is parsed
   * as an opening italic marker with no close, returning HTTP 400.
   *
   * Strategy: lift valid markdown patterns into NUL-sentinel placeholders,
   * escape the remaining specials, then restore the placeholders.
   */
  private formatForTelegram(text: string): string {
    const lifted: string[] = [];
    const lift = (s: string) => `\x00${lifted.push(s) - 1}\x00`;

    // Lift valid markdown patterns in priority order — they bypass the escape step below.
    text = text.replace(/```[\s\S]*?```/g, lift); // code blocks
    text = text.replace(/`[^`]+`/g, lift); // inline code
    text = text.replace(/\*\*([^*]+?)\*\*/g, (_, c) => lift(`*${c}*`)); // **bold** → *bold*
    text = text.replace(/(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)/g, (_, c) => lift(`_${c}_`)); // *italic* → _italic_
    text = text.replace(/\[[^\]]+\]\([^)]+\)/g, lift); // [text](url)

    // Escape literal markdown specials so Telegram treats them as text.
    text = text.replace(/[_*[`]/g, "\\$&");

    return text.replace(/\x00(\d+)\x00/g, (_, i) => lifted[parseInt(i, 10)]);
  }

  /**
   * node-telegram-bot-api pulls in `request` and friends, which cost about
   * 100ms of module evaluation. Loading it here keeps that off the extension
   * startup path whenever Telegram is not the configured transport.
   */
  private async loadTelegramBot(): Promise<typeof TelegramBot> {
    const mod = await import("node-telegram-bot-api");
    return (mod as { default: typeof TelegramBot }).default;
  }

  /**
   * A 409 from getUpdates means Telegram still has the previous long-poll
   * registered for this bot. That happens in the window right after a
   * reconnect. node-telegram-bot-api retries on its own, so it is not an error
   * worth surfacing.
   */
  private static isPollOwnershipConflict(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return message.toLowerCase().includes("terminated by other getupdates");
  }

  async connect(): Promise<void> {
    if (this._isConnected) return;

    const TelegramBotCtor = await this.loadTelegramBot();
    this.bot = new TelegramBotCtor(this.token, {
      polling: {
        interval: 300,
        autoStart: false,
      },
    });

    // Handle incoming messages
    this.bot.on("message", async (msg) => {
      try {
        await this.handleMessage(msg);
      } catch (err) {
        if (this.errorHandler) {
          this.errorHandler(err as Error);
        }
      }
    });

    // Handle polling errors
    this.bot.on("polling_error", (err) => {
      if (TelegramProvider.isPollOwnershipConflict(err)) return;
      if (this.errorHandler) {
        this.errorHandler(err);
      }
    });

    // startPolling() resolves when the *first* getUpdates comes back. With the
    // default 10s long-poll that is 10 seconds of dead time before the caller
    // learns the bot is up, so cap the wait and let the poll continue in the
    // background. Polling failures arrive through polling_error either way.
    const firstPoll = this.bot.startPolling().catch(() => undefined);
    await withDeadline(firstPoll, FIRST_POLL_TIMEOUT_MS);
    this._isConnected = true;
  }

  async disconnect(): Promise<void> {
    if (!this._isConnected || !this.bot) return;

    // `stopPolling()` with no options waits for the in-flight getUpdates
    // long-poll to return from Telegram, up to `polling.params.timeout`
    // (10 seconds by default). Pi awaits `session_shutdown` handlers before it
    // builds the next session, so that wait froze the UI for 5-10s on every
    // /new, /resume, fork, /reload and quit. `cancel: true` aborts the pending
    // request instead and returns in about a millisecond.
    await this.bot.stopPolling({ cancel: true });
    this._isConnected = false;
    this.bot = undefined;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.bot) {
      throw new Error("Telegram bot not connected");
    }
    if (!text?.trim()) return;
    const formattedText = this.formatForTelegram(text);
    await this.bot.sendMessage(chatId, formattedText, { parse_mode: "Markdown" });
  }

  async sendTyping(chatId: string): Promise<void> {
    if (!this.bot) return;
    await this.bot.sendChatAction(chatId, "typing");
  }

  /**
   * Send a file. Images Telegram can render go out through `sendPhoto` and show
   * as an inline preview; everything else, including SVG and PDF, goes through
   * `sendDocument`, which is also the only route above 5 MB.
   *
   * The caption is sent as plain text. MarkdownV1 in a caption hits the same
   * parse errors the body text did before `formatForTelegram` existed, and a
   * caption is not worth that failure mode.
   */
  async sendMedia(chatId: string, media: OutgoingMedia): Promise<void> {
    if (!this.bot) {
      throw new Error("Telegram bot not connected");
    }
    const caption = media.caption?.trim() || undefined;
    if (sendMethodFor(media.mimeType, media.data.length) === "photo") {
      await this.bot.sendPhoto(chatId, media.data, { caption }, {
        filename: media.fileName ?? "photo.jpg",
        contentType: media.mimeType,
      });
      return;
    }
    // contentType is required, not cosmetic. node-telegram-bot-api sniffs a
    // Buffer's magic bytes when it is missing, and SVG or PDF-as-text has no
    // signature, so the call throws `Unsupported Buffer file-type`.
    await this.bot.sendDocument(
      chatId,
      media.data,
      { caption },
      { filename: media.fileName, contentType: media.mimeType }
    );
  }

  onMessage(handler: (message: ExternalMessage) => void): void {
    this.messageHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  private async handleMessage(msg: TelegramBot.Message): Promise<void> {
    // Filter out old messages (prevent stale message processing on reconnect)
    if (msg.message_id <= this.lastProcessedMessageId) {
      return;
    }
    this.lastProcessedMessageId = msg.message_id;

    // A photo arrives as msg.photo with no msg.text, and a captioned photo puts
    // the caption in msg.caption. Requiring msg.text here used to drop both
    // kinds before the auth check, which is why sending the bot a picture
    // produced no reply at all.
    if (!msg.from) {
      return;
    }

    const mediaSettings = resolveMediaSettings(this.mediaSettings);
    const attachments = mediaSettings.enabled
      ? await this.collectAttachments(msg, mediaSettings)
      : [];
    const text = msg.text ?? msg.caption ?? "";
    if (!text && attachments.length === 0) {
      return;
    }

    const chatId = msg.chat.id.toString();
    const userId = msg.from.id.toString();
    const username = msg.from.username || msg.from.first_name || "unknown";
    const isGroupChat = msg.chat.type !== "private";

    // Check if bot was mentioned in group chat
    let wasMentioned = false;
    if (isGroupChat && this.bot) {
      const botInfo = await this.bot.getMe();
      const botUsername = botInfo.username;
      wasMentioned =
        text.includes(`@${botUsername}`) ||
        (msg.entities?.some(
          (entity) =>
            entity.type === "mention" &&
            text.substring(entity.offset, entity.offset + entity.length) ===
              `@${botUsername}`
        ) ?? false);
    }

    // Check authorization (with sendMessage callback for challenge notifications)
    const sendMessageToUser = async (cId: string, text: string) => {
      if (this.bot) {
        await this.bot.sendMessage(cId, text, { parse_mode: "Markdown" });
      }
    };
    
    const isAuthorized = await this.auth.checkAuthorization(
      userId,
      chatId,
      username,
      isGroupChat,
      wasMentioned,
      sendMessageToUser,
      this.type
    );

    // Handle admin commands and challenge codes in DM (before auth check!)
    if (!isGroupChat && (text.startsWith("/") || text.match(/^\d{6}$/))) {
      const handled = await this.auth.handleAdminCommand(
        text,
        chatId,
        userId,
        async (text) => await this.sendMessage(chatId, text),
        this.type
      );
      if (handled) {
        return;
      }
    }

    if (!isAuthorized) {
      return; // Auth handler already sent challenge/error messages
    }

    // Strip bot mention from message if present
    let content = text;
    if (wasMentioned && this.bot) {
      const botInfo = await this.bot.getMe();
      const botUsername = botInfo.username;
      content = content.replace(new RegExp(`@${botUsername}\\s*`, "g"), "").trim();
    }

    // Forward to message handler
    if (this.messageHandler && (content || attachments.length > 0)) {
      const externalMessage: ExternalMessage = {
        chatId,
        transport: this.type,
        content,
        username,
        userId,
        timestamp: new Date((msg.date || 0) * 1000),
        messageId: msg.message_id.toString(),
        isGroupChat,
        wasMentioned,
        attachments,
      };

      this.messageHandler(externalMessage);
    }
  }

  /**
   * Download whatever images the message carries.
   *
   * Telegram sends a photo as an array of pre-cropped sizes, so the largest
   * entry is the one worth fetching. An image sent as a file lands in
   * `msg.document` instead, with a real mime type and file name.
   *
   * A download that fails is skipped rather than raised. Losing one attachment
   * should not cost the user the caption they typed with it.
   */
  private async collectAttachments(
    msg: TelegramBot.Message,
    settings: MediaSettings
  ): Promise<RemoteAttachment[]> {
    if (!this.bot) return [];

    const candidates: Array<{
      fileId: string;
      mimeType: string;
      fileName?: string;
      size?: number;
    }> = [];

    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo.reduce((best, size) =>
        (size.file_size ?? 0) > (best.file_size ?? 0) ? size : best
      );
      candidates.push({
        fileId: largest.file_id,
        // Telegram gives no mime type for photos. JPEG matches what it stores
        // for anything it re-encoded; a PNG or SVG the user sent as a file
        // arrives through msg.document with the real type instead.
        mimeType: "image/jpeg",
        size: largest.file_size,
      });
    } else if (msg.document?.mime_type?.startsWith("image/")) {
      candidates.push({
        fileId: msg.document.file_id,
        mimeType:
          msg.document.mime_type ??
          mimeFromPath(msg.document.file_name ?? "") ??
          "image/jpeg",
        fileName: msg.document.file_name,
        size: msg.document.file_size,
      });
    }

    const attachments: RemoteAttachment[] = [];
    for (const candidate of candidates.slice(0, settings.maxImages ?? 4)) {
      if (candidate.size && candidate.size > (settings.maxBytes ?? 0)) {
        this.errorHandler?.(
          new Error(
            `Skipped ${candidate.fileName ?? "photo"}: ${formatBytes(candidate.size)} over the ${formatBytes(settings.maxBytes ?? 0)} limit`
          )
        );
        continue;
      }
      try {
        attachments.push(await this.downloadAttachment(candidate));
      } catch (err) {
        this.errorHandler?.(
          new Error(`Attachment download failed: ${(err as Error).message}`)
        );
      }
    }
    return attachments;
  }

  /**
   * Fetch one Telegram file and return it as base64.
   *
   * `downloadFile` writes into a directory it does not create, so each file gets
   * its own temp directory, removed afterwards. Telegram expires the file about
   * an hour after the message arrives, which is why the bytes have to be read
   * now rather than handed to a later turn as an id.
   */
  private async downloadAttachment(candidate: {
    fileId: string;
    mimeType: string;
    fileName?: string;
  }): Promise<RemoteAttachment> {
    const bot = this.bot!;
    const file = await bot.getFile(candidate.fileId);
    if (!file.file_path) {
      throw new Error(`Telegram returned no file path for ${candidate.fileId}`);
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msg-bridge-"));
    try {
      const written = await bot.downloadFile(candidate.fileId, dir);
      const data = fs.readFileSync(written).toString("base64");
      return {
        mimeType: candidate.mimeType,
        data,
        fileName: candidate.fileName ?? path.basename(written),
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
