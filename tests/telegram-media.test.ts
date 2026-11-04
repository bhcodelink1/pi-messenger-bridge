/**
 * Telegram attachment handling, inbound and outbound, against a stub bot.
 *
 * Two regressions live here. A photo used to arrive as `msg.photo` with no
 * `msg.text`, and the transport's text guard dropped it before the auth check,
 * so the bot never answered a picture. Outbound had no route at all, so a chart
 * reached the phone as a path string.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TelegramProvider } from '../src/transports/telegram';
import type { ExternalMessage } from '../src/types';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Sent = { chatId: string; data: Buffer; options?: any; fileOptions?: any };

function stubBot(options: { fileSize?: number } = {}) {
  const photos: Sent[] = [];
  const documents: Sent[] = [];
  const downloads: string[] = [];

  const bot = {
    async getFile(fileId: string) {
      return { file_id: fileId, file_size: options.fileSize ?? PNG.length, file_path: `photos/${fileId}.jpg` };
    },
    async downloadFile(fileId: string, dir: string) {
      downloads.push(fileId);
      const dest = path.join(dir, `${fileId}.jpg`);
      fs.writeFileSync(dest, PNG);
      return dest;
    },
    async sendChatAction() {},
    async getMe() {
      return { username: 'testbot' };
    },
    async sendMessage(chatId: string, text: string) {
      return { message_id: 1, chatId, text };
    },
    async sendPhoto(chatId: string, data: Buffer, options?: any, fileOptions?: any) {
      photos.push({ chatId, data, options, fileOptions });
      return { message_id: 2 };
    },
    async sendDocument(chatId: string, data: Buffer, options?: any, fileOptions?: any) {
      documents.push({ chatId, data, options, fileOptions });
      return { message_id: 3 };
    },
  };

  return { bot, photos, documents, downloads };
}

const auth = {
  checkAuthorization: async () => true,
  handleAdminCommand: async () => false,
} as never;

function build(media?: Record<string, unknown>) {
  const provider = new TelegramProvider('token', auth, media as never);
  return provider;
}

async function deliver(
  provider: TelegramProvider,
  bot: unknown,
  msg: Record<string, unknown>
): Promise<ExternalMessage[]> {
  const received: ExternalMessage[] = [];
  (provider as any).bot = bot;
  provider.onMessage((m) => received.push(m));
  provider.onError(() => {});
  await (provider as any).handleMessage(msg);
  return received;
}

describe('Telegram inbound photos', () => {
  it('delivers a bare photo as an attachment instead of dropping it', async () => {
    const { bot } = stubBot();
    const received = await deliver(build(), bot, {
      message_id: 10,
      from: { id: 1, first_name: 'Bala' },
      chat: { id: 55, type: 'private' },
      date: 1700000000,
      photo: [
        { file_id: 'small', file_size: 100, width: 90, height: 90 },
        { file_id: 'large', file_size: 4000, width: 800, height: 600 },
      ],
    });

    expect(received).toHaveLength(1);
    expect(received[0].attachments).toHaveLength(1);
    expect(received[0].attachments?.[0].mimeType).toBe('image/jpeg');
    expect(Buffer.from(received[0].attachments![0].data, 'base64')).toEqual(PNG);
  });

  it('uses the caption as the text of a captioned photo', async () => {
    const { bot } = stubBot();
    const received = await deliver(build(), bot, {
      message_id: 11,
      from: { id: 1, first_name: 'Bala' },
      chat: { id: 55, type: 'private' },
      date: 1700000000,
      caption: 'what does this say',
      photo: [{ file_id: 'large', file_size: 4000, width: 800, height: 600 }],
    });

    expect(received[0].content).toBe('what does this say');
    expect(received[0].attachments).toHaveLength(1);
  });

  it('still drops a message with neither text nor an attachment', async () => {
    const { bot } = stubBot();
    const received = await deliver(build(), bot, {
      message_id: 12,
      from: { id: 1, first_name: 'Bala' },
      chat: { id: 55, type: 'private' },
      date: 1700000000,
    });

    expect(received).toHaveLength(0);
  });

  it('takes an image sent as a file with its real mime type and name', async () => {
    const { bot } = stubBot();
    const received = await deliver(build(), bot, {
      message_id: 13,
      from: { id: 1, first_name: 'Bala' },
      chat: { id: 55, type: 'private' },
      date: 1700000000,
      document: {
        file_id: 'doc1',
        file_size: 3000,
        file_name: 'diagram.png',
        mime_type: 'image/png',
      },
    });

    expect(received[0].attachments?.[0].mimeType).toBe('image/png');
    expect(received[0].attachments?.[0].fileName).toBe('diagram.png');
  });

  it('skips an attachment over the configured byte limit', async () => {
    const { bot } = stubBot({ fileSize: 9 * 1024 * 1024 });
    const errors: Error[] = [];
    const provider = build({ maxBytes: 5 * 1024 * 1024 });
    (provider as any).bot = bot;
    provider.onMessage(() => {});
    provider.onError((e) => errors.push(e));

    await (provider as any).handleMessage({
      message_id: 14,
      from: { id: 1, first_name: 'Bala' },
      chat: { id: 55, type: 'private' },
      date: 1700000000,
      photo: [{ file_id: 'big', file_size: 9 * 1024 * 1024, width: 4000, height: 4000 }],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/over the 5.0 MB limit/);
  });

  it('collects nothing when media support is disabled', async () => {
    const { bot, downloads } = stubBot();
    const received = await deliver(build({ enabled: false }), bot, {
      message_id: 15,
      from: { id: 1, first_name: 'Bala' },
      chat: { id: 55, type: 'private' },
      date: 1700000000,
      caption: 'ignore the picture',
      photo: [{ file_id: 'large', file_size: 4000, width: 800, height: 600 }],
    });

    expect(downloads).toHaveLength(0);
    expect(received[0].attachments).toHaveLength(0);
    expect(received[0].content).toBe('ignore the picture');
  });
});

describe('Telegram outbound media', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-media-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sends a small PNG through sendPhoto', async () => {
    const { bot, photos, documents } = stubBot();
    const provider = build();
    (provider as any).bot = bot;

    await provider.sendMedia('55', { data: PNG, mimeType: 'image/png', fileName: 'chart.png' });

    expect(photos).toHaveLength(1);
    expect(documents).toHaveLength(0);
    expect(photos[0].data).toEqual(PNG);
    expect(photos[0].fileOptions?.contentType).toBe('image/png');
    expect(photos[0].fileOptions?.filename).toBe('chart.png');
  });

  it('sends SVG through sendDocument with the original file name', async () => {
    const { bot, photos, documents } = stubBot();
    const provider = build();
    (provider as any).bot = bot;

    await provider.sendMedia('55', {
      data: Buffer.from('<svg/>'),
      mimeType: 'image/svg+xml',
      fileName: 'chart.svg',
      caption: 'price history',
    });

    expect(photos).toHaveLength(0);
    expect(documents[0].fileOptions?.filename).toBe('chart.svg');
    // Without contentType the library sniffs magic bytes, finds no signature in
    // text, and throws before Telegram ever sees the request.
    expect(documents[0].fileOptions?.contentType).toBe('image/svg+xml');
    expect(documents[0].options?.caption).toBe('price history');
  });

  it('refuses to send when the bot is not connected', async () => {
    const provider = build();

    await expect(
      provider.sendMedia('55', { data: PNG, mimeType: 'image/png' })
    ).rejects.toThrow(/not connected/);
  });
});
