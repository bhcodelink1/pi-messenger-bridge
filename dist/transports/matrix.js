import * as os from "os";
import * as path from "path";
import { withDeadline } from "../async-util.js";
import { formatBytes, resolveMediaSettings } from "../media.js";
import { extractUsername, formatForMatrix, mediaFromContent, shouldSkipEvent, stripBotMention, wasBotMentioned, } from "./matrix-utils.js";
/** Bound on how long Matrix teardown may take before we move on without it. */
const DISCONNECT_TIMEOUT_MS = 500;
/**
 * Matrix transport provider using matrix-bot-sdk
 * Works with any Matrix homeserver — Element X, Element Web, FluffyChat, etc.
 */
export class MatrixProvider {
    config;
    auth;
    mediaSettings;
    type = "matrix";
    client;
    _isConnected = false;
    messageHandler;
    errorHandler;
    botUserId;
    joinedRooms = new Set();
    roomMemberCount = new Map();
    connectedAt = 0;
    constructor(config, auth, mediaSettings) {
        this.config = config;
        this.auth = auth;
        this.mediaSettings = mediaSettings;
    }
    get isConnected() {
        return this._isConnected;
    }
    // Formatting delegated to matrix-utils.ts (pure, testable)
    async connect() {
        if (this._isConnected)
            return;
        const { homeserverUrl, accessToken } = this.config;
        if (!homeserverUrl || !accessToken) {
            throw new Error("Matrix homeserver URL and access token required");
        }
        // matrix-bot-sdk plus its Rust crypto native binding cost about 100ms of
        // module evaluation, so the SDK loads only when a Matrix transport connects.
        const { AutojoinRoomsMixin, LogService, MatrixClient: MatrixClientCtor, RichConsoleLogger, RustSdkCryptoStorageProvider: RustSdkCryptoStorageProviderCtor, SimpleFsStorageProvider, } = await import("matrix-bot-sdk");
        // matrix-bot-sdk re-exports RustSdkCryptoStoreType as a type only, so the
        // named import from it is undefined at runtime. Passing undefined reaches
        // OlmMachine.initialize and E2EE silently never works, so the enum comes
        // from the native package that actually defines it.
        const { StoreType } = await import("@matrix-org/matrix-sdk-crypto-nodejs");
        const storagePath = path.join(os.homedir(), ".pi", "msg-bridge-matrix-store.json");
        const storage = new SimpleFsStorageProvider(storagePath);
        // Set up E2EE crypto storage if encryption is enabled.
        // Uses @matrix-org/matrix-sdk-crypto-nodejs (native Rust, SQLite on disk).
        // Crypto state persists across restarts — same device, same keys.
        // The device must be verified once from another Matrix client (Element, etc).
        let cryptoProvider;
        if (this.config.encryption !== false) {
            try {
                const cryptoStorePath = path.join(os.homedir(), ".pi", "msg-bridge-matrix-crypto");
                cryptoProvider = new RustSdkCryptoStorageProviderCtor(cryptoStorePath, 0 /* StoreType.Sqlite */);
                console.log("[Matrix] E2EE crypto storage enabled (Rust/SQLite)");
            }
            catch (err) {
                console.warn("[Matrix] E2EE crypto not available, continuing without encryption:", err.message);
            }
        }
        this.client = new MatrixClientCtor(homeserverUrl, accessToken, storage, cryptoProvider);
        // Auto-join rooms the bot is invited to
        AutojoinRoomsMixin.setupOnClient(this.client);
        // Cache bot user ID (never changes)
        this.botUserId = await this.client.getUserId();
        // Track room membership and member counts
        this.client.on("room.join", (roomId) => {
            this.joinedRooms.add(roomId);
            // Refresh member count asynchronously
            this.client?.getJoinedRoomMembers(roomId)
                .then(members => this.roomMemberCount.set(roomId, members.length))
                .catch(() => { });
        });
        this.client.on("room.leave", (roomId) => {
            this.joinedRooms.delete(roomId);
            this.roomMemberCount.delete(roomId);
        });
        // Handle incoming messages
        this.client.on("room.message", async (roomId, event) => {
            try {
                await this.handleMessage(roomId, event);
            }
            catch (err) {
                if (this.errorHandler) {
                    this.errorHandler(err);
                }
            }
        });
        try {
            // During initial sync the SDK replays historical events and tries to
            // decrypt them. For E2EE rooms this produces two known error patterns:
            //   1. "Decryption error" — old messages we don't have keys for
            //   2. "M_NOT_FOUND"     — stale sync token references a purged event
            // Our connectedAt filter skips these events anyway, so the errors are
            // noise. A filtering logger suppresses only these specific patterns.
            const defaultLogger = new RichConsoleLogger();
            const syncFilterLogger = {
                info: (mod, ...args) => defaultLogger.info(mod, ...args),
                warn: (mod, ...args) => defaultLogger.warn(mod, ...args),
                debug: (mod, ...args) => defaultLogger.debug(mod, ...args),
                trace: (mod, ...args) => defaultLogger.trace(mod, ...args),
                error: (mod, ...args) => {
                    const msg = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
                    if (mod === "MatrixClientLite" && msg.includes("Decryption error"))
                        return;
                    if (mod === "MatrixHttpClient" && msg.includes("M_NOT_FOUND"))
                        return;
                    defaultLogger.error(mod, ...args);
                },
            };
            LogService.setLogger(syncFilterLogger);
            await this.client.start();
            // Restore default logging — real errors after sync should not be filtered
            LogService.setLogger(defaultLogger);
        }
        catch (error) {
            // Clean up dangling state so connect() can be retried
            this.client = undefined;
            this.botUserId = undefined;
            this.joinedRooms.clear();
            this.roomMemberCount.clear();
            console.error("[Matrix] Failed to connect:", error);
            throw error;
        }
        // Seed joined rooms and member count caches
        const rooms = await this.client.getJoinedRooms();
        this.joinedRooms = new Set(rooms);
        await Promise.all(rooms.map(async (roomId) => {
            try {
                const members = await this.client.getJoinedRoomMembers(roomId);
                this.roomMemberCount.set(roomId, members.length);
            }
            catch {
                // Will be fetched on first message if needed
            }
        }));
        this.connectedAt = Date.now();
        this._isConnected = true;
        const cryptoStatus = cryptoProvider ? "E2EE enabled" : "E2EE disabled";
        console.log(`✅ Matrix connected as ${this.botUserId} (${rooms.length} rooms, ${cryptoStatus})`);
    }
    async disconnect() {
        if (!this._isConnected || !this.client)
            return;
        const client = this.client;
        this.client = undefined;
        this._isConnected = false;
        this.botUserId = undefined;
        this.joinedRooms.clear();
        this.roomMemberCount.clear();
        this.connectedAt = 0;
        // The SDK types declare stop() as void even though it starts an async
        // shutdown of the sync loop, so normalise before bounding the wait.
        const stopping = client.stop();
        await withDeadline(Promise.resolve(stopping).catch(() => undefined), DISCONNECT_TIMEOUT_MS);
        console.log("[Matrix] Disconnected");
    }
    async sendMessage(chatId, text) {
        if (!this.client) {
            throw new Error("Matrix client not connected");
        }
        if (!text?.trim())
            return;
        const { body, formattedBody } = formatForMatrix(text);
        await this.client.sendMessage(chatId, {
            msgtype: "m.text",
            body,
            ...(formattedBody && {
                format: "org.matrix.custom.html",
                formatted_body: formattedBody,
            }),
        });
    }
    async sendTyping(chatId) {
        if (!this.client)
            return;
        try {
            await this.client.setTyping(chatId, true, 10000);
        }
        catch {
            // Ignore typing indicator errors
        }
    }
    /**
     * Send a file to a room.
     *
     * Matrix stores bytes in a media repository and references them by `mxc://`
     * URI, so an upload always precedes the event. In an encrypted room the file
     * itself is encrypted too, separately from the event: `encryptMedia` produces
     * the ciphertext plus the key/hash descriptor that goes in `content.file`, and
     * the ciphertext is what gets uploaded. Sending the plaintext bytes to an
     * encrypted room would leak the image to the homeserver.
     */
    async sendMedia(chatId, media) {
        if (!this.client) {
            throw new Error("Matrix client not connected");
        }
        const fileName = media.fileName ?? "file";
        const caption = media.caption?.trim();
        const content = {
            msgtype: media.mimeType.startsWith("image/") ? "m.image" : "m.file",
            body: caption || fileName,
            filename: fileName,
            info: { mimetype: media.mimeType, size: media.data.length },
        };
        const crypto = this.client.crypto;
        // Two reasons not to trust `crypto.isRoomEncrypted`: the SDK's room tracker
        // only knows a room once it processed the state event, which misses rooms
        // encrypted before the bot joined, and the per-key state endpoint 404s on an
        // empty state key. Reading the whole state is the reliable check.
        let roomIsEncrypted = false;
        try {
            const state = await this.client.getRoomState(chatId);
            roomIsEncrypted = (state ?? []).some((e) => e?.type === 'm.room.encryption' &&
                e?.content?.algorithm === 'm.megolm.v1.aes-sha2');
        }
        catch {
            roomIsEncrypted = crypto
                ? await crypto.isRoomEncrypted(chatId).catch(() => false)
                : false;
        }
        if (roomIsEncrypted && !crypto) {
            throw new Error(`Room ${chatId} is encrypted but crypto is disabled ("encryption": false), so media cannot be sent safely`);
        }
        if (roomIsEncrypted && crypto) {
            const { buffer, file } = await crypto.encryptMedia(media.data);
            const mxc = await this.client.uploadContent(buffer, "application/octet-stream", fileName);
            content.file = { ...file, url: mxc };
        }
        else {
            const mxc = await this.client.uploadContent(media.data, media.mimeType, fileName);
            content.url = mxc;
        }
        await this.client.sendMessage(chatId, content);
    }
    onMessage(handler) {
        this.messageHandler = handler;
    }
    onError(handler) {
        this.errorHandler = handler;
    }
    /**
     * Fetch one media reference and return it as base64.
     *
     * An encrypted descriptor has to go through `crypto.decryptMedia`, which
     * downloads and decrypts in one step. A plain reference downloads straight
     * from the media repository.
     */
    async downloadAttachment(ref, settings) {
        const client = this.client;
        if (ref.size && ref.size > (settings.maxBytes ?? 0)) {
            throw new Error(`${ref.fileName ?? "image"} is ${formatBytes(ref.size)}, over the ${formatBytes(settings.maxBytes ?? 0)} limit`);
        }
        let data;
        if (ref.file && client.crypto) {
            data = await client.crypto.decryptMedia(ref.file);
        }
        else if (ref.mxc) {
            data = (await client.downloadContent(ref.mxc)).data;
        }
        else {
            throw new Error(`${ref.fileName ?? "image"} carries no media reference`);
        }
        if (data.length > (settings.maxBytes ?? 0)) {
            throw new Error(`${ref.fileName ?? "image"} is ${formatBytes(data.length)}, over the ${formatBytes(settings.maxBytes ?? 0)} limit`);
        }
        return {
            mimeType: ref.mimeType,
            data: data.toString("base64"),
            fileName: ref.fileName,
        };
    }
    async handleMessage(roomId, event) {
        if (!this.client || !this.botUserId)
            return;
        // Pure filter — delegates to testable utility
        const skipReason = shouldSkipEvent(event, this.botUserId, this.connectedAt, this.joinedRooms, roomId);
        if (skipReason)
            return;
        const chatId = roomId;
        const userId = event.sender; // e.g. @user:matrix.org
        const username = extractUsername(userId);
        const messageText = typeof event.content.body === "string" ? event.content.body : "";
        const messageId = event.event_id;
        // An image arrives with a media reference and usually no prose. Element puts
        // the file name in `body`, so the text is kept whatever the media holds.
        const mediaSettings = resolveMediaSettings(this.mediaSettings);
        const mediaRef = mediaSettings.enabled ? mediaFromContent(event.content) : null;
        const attachments = [];
        if (mediaRef) {
            try {
                attachments.push(await this.downloadAttachment(mediaRef, mediaSettings));
            }
            catch (err) {
                this.errorHandler?.(new Error(err.message));
            }
        }
        // Determine if group chat from cached member count (no API call per message)
        let memberCount = this.roomMemberCount.get(roomId);
        if (memberCount === undefined) {
            // Cache miss — fetch once and cache
            try {
                const members = await this.client.getJoinedRoomMembers(roomId);
                memberCount = members.length;
                this.roomMemberCount.set(roomId, memberCount);
            }
            catch {
                memberCount = 2; // Default to DM if we can't check
            }
        }
        const isGroupChat = memberCount > 2;
        // Check if bot was mentioned (pure utility)
        const wasMentioned = isGroupChat ? wasBotMentioned(messageText, this.botUserId) : false;
        // Check authorization
        const sendMessageToUser = async (cId, text) => {
            await this.sendMessage(cId, text);
        };
        const isAuthorized = await this.auth.checkAuthorization(userId, chatId, username, isGroupChat, wasMentioned, sendMessageToUser, this.type);
        // Handle challenge codes and commands in DMs
        if (!isGroupChat &&
            (messageText.startsWith("/") || messageText.match(/^\d{6}$/))) {
            const handled = await this.auth.handleAdminCommand(messageText, chatId, userId, async (text) => await this.sendMessage(chatId, text), this.type);
            if (handled)
                return;
        }
        if (!isAuthorized)
            return;
        // Strip bot mention from message (pure utility)
        const cleanContent = wasMentioned && this.botUserId
            ? stripBotMention(messageText, this.botUserId)
            : messageText;
        // Forward to message handler
        if (this.messageHandler && (cleanContent || attachments.length > 0)) {
            const externalMessage = {
                chatId,
                transport: this.type,
                content: cleanContent,
                username,
                userId,
                timestamp: new Date(event.origin_server_ts || Date.now()),
                messageId,
                isGroupChat,
                wasMentioned,
                attachments,
            };
            this.messageHandler(externalMessage);
        }
    }
}
//# sourceMappingURL=matrix.js.map