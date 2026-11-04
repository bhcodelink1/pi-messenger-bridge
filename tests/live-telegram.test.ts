/**
 * Live Telegram round trip. Skipped unless `LIVE_TELEGRAM=1`.
 *
 * The unit tests stub the bot, so they cannot prove the real API contract: that
 * `sendPhoto` accepts these bytes, that `sendDocument` takes an SVG, and that
 * `getFile` plus `downloadFile` returns the stored file. Run it by hand against
 * a configured bot:
 *
 *   LIVE_TELEGRAM=1 npx vitest run tests/live-telegram.test.ts
 *
 * It posts two messages to the first trusted user, one photo and one document.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TelegramProvider } from '../src/transports/telegram';

const run = process.env.LIVE_TELEGRAM === '1' ? describe : describe.skip;

const authStub = {
  checkAuthorization: async () => true,
  handleAdminCommand: async () => false,
} as never;

function loadTelegramConfig(): { token: string; chatId: string } {
  const file = path.join(os.homedir(), '.pi', 'msg-bridge.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const trusted: string = config.auth?.trustedUsers?.[0];
  if (!config.telegram?.token || !trusted) {
    throw new Error('msg-bridge.json has no telegram token or trusted user');
  }
  return { token: config.telegram.token, chatId: trusted.split(':').slice(1).join(':') };
}

async function connectBot(token: string): Promise<any> {
  const mod = await import('node-telegram-bot-api');
  const TelegramBot = (mod as { default: any }).default;
  return new TelegramBot(token, { polling: false });
}

run('live Telegram media round trip', () => {
  it(
    'posts a photo and reads the stored file back through the inbound path',
    async () => {
      const { token, chatId } = loadTelegramConfig();
      const bot = await connectBot(token);

      const png = fs.readFileSync(path.join(process.cwd(), 'media', 'screenshot.png'));
      const provider = new TelegramProvider(token, authStub);
      (provider as any).bot = bot;

      const sent = await bot.sendPhoto(chatId, png, {
        caption: 'msg-bridge sendPhoto check',
      });
      expect(sent.photo?.length).toBeGreaterThan(0);

      const largest = sent.photo!.reduce((best: any, size: any) =>
        (size.file_size ?? 0) > (best.file_size ?? 0) ? size : best
      );

      // downloadAttachment is the exact call an inbound photo takes, so this
      // proves the file server round trip without waiting for a human to send
      // a picture.
      const attachment = await (provider as any).downloadAttachment({
        fileId: largest.file_id,
        mimeType: 'image/jpeg',
      });

      expect(attachment.mimeType).toBe('image/jpeg');
      expect(Buffer.from(attachment.data, 'base64').length).toBeGreaterThan(1000);
    },
    60_000
  );

  it(
    'posts an SVG through sendDocument',
    async () => {
      const { token, chatId } = loadTelegramConfig();
      const bot = await connectBot(token);

      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80">' +
          '<rect width="200" height="80" fill="#eee"/>' +
          '<text x="10" y="45" font-size="18">msg-bridge doc check</text></svg>'
      );
      const provider = new TelegramProvider(token, authStub);
      (provider as any).bot = bot;

      await provider.sendMedia(chatId, {
        data: svg,
        mimeType: 'image/svg+xml',
        fileName: 'msg-bridge-check.svg',
        caption: 'sendDocument route for SVG',
      });
    },
    60_000
  );
});
