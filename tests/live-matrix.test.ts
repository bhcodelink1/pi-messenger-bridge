/**
 * Live Matrix round trips. Skipped unless `LIVE_MATRIX=1`.
 *
 * The stub-client tests cannot prove the wire format: that `uploadContent`
 * returns a usable `mxc://` URI, that an `m.image` event carries the shape real
 * clients expect, that `downloadContent` returns the same bytes, and that media
 * in an encrypted room goes up as ciphertext. Run them against a throwaway
 * homeserver with two accounts, one playing the bot and one the human:
 *
 *   LIVE_MATRIX=1 MATRIX_URL=http://localhost:8008 \
 *   MATRIX_BOT_TOKEN=... MATRIX_USER_TOKEN=... \
 *   npx vitest run tests/live-matrix.test.ts
 *
 * Use tokens from a fresh login. Reusing an old device re-uploads one-time keys
 * the server still holds, which fails with `One time key … already exists`.
 */
import { describe, expect, it } from 'vitest';
import { MatrixClient } from 'matrix-bot-sdk';
import { MatrixProvider } from '../src/transports/matrix';
import type { ExternalMessage } from '../src/types';

const run = process.env.LIVE_MATRIX === '1' ? describe : describe.skip;

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const authStub = {
  checkAuthorization: async () => true,
  handleAdminCommand: async () => false,
} as never;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(what: () => Promise<T | null>, timeoutMs = 25_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await what();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await sleep(250);
  }
}

async function latestMessages(user: MatrixClient, roomId: string): Promise<any[]> {
  const res = await user.doRequest(
    'GET',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`,
    { dir: 'b', limit: '10' }
  );
  return res.chunk as any[];
}

run('live Matrix media, unencrypted room', () => {
  it(
    'receives an uploaded image and posts one back',
    async () => {
      const url = env('MATRIX_URL');
      const user = new MatrixClient(url, env('MATRIX_USER_TOKEN'));
      const provider = new MatrixProvider(
        { homeserverUrl: url, accessToken: env('MATRIX_BOT_TOKEN'), encryption: false },
        authStub
      );

      const received: ExternalMessage[] = [];
      provider.onMessage((m) => received.push(m));
      provider.onError(() => {});

      await user.start();
      const botId = await new MatrixClient(url, env('MATRIX_BOT_TOKEN')).getUserId();
      await provider.connect();

      try {
        const roomId = await user.createRoom({
          is_direct: true,
          invite: [botId],
          preset: 'trusted_private_chat',
        });
        await waitFor(async () =>
          (provider as any).joinedRooms.has(roomId) ? true : null
        );

        const mxc = await user.uploadContent(PNG, 'image/png', 'photo.png');
        await user.sendMessage(roomId, {
          msgtype: 'm.image',
          body: 'what is in this picture',
          url: mxc,
          info: { mimetype: 'image/png', size: PNG.length },
        });

        const inbound = await waitFor(async () =>
          received.find((m) => (m.attachments?.length ?? 0) > 0) ?? null
        );
        expect(inbound.content).toBe('what is in this picture');
        expect(Buffer.from(inbound.attachments![0].data, 'base64')).toEqual(PNG);
        expect(inbound.attachments![0].mimeType).toBe('image/png');

        await provider.sendMedia(roomId, {
          data: PNG,
          mimeType: 'image/png',
          fileName: 'chart.png',
          caption: 'live matrix check',
        });

        const posted = await waitFor(async () => {
          const chunk = await latestMessages(user, roomId);
          return (
            chunk.find(
              (e) => e.type === 'm.room.message' && e.content.msgtype === 'm.image'
            ) ?? null
          );
        });

        expect(posted.content.body).toBe('live matrix check');
        expect(posted.content.filename).toBe('chart.png');
        expect(String(posted.content.url)).toMatch(/^mxc:\/\//);
      } finally {
        await provider.disconnect();
        await user.stop();
      }
    },
    90_000
  );
});

run('live Matrix media, encrypted room', () => {
  it(
    'decrypts an inbound image and encrypts an outbound one',
    async () => {
      const {
        MatrixClient: Ctor,
        RustSdkCryptoStorageProvider,
        SimpleFsStorageProvider,
      } = await import('matrix-bot-sdk');
      const { StoreType } = await import('@matrix-org/matrix-sdk-crypto-nodejs');
      const url = env('MATRIX_URL');

      const user = new Ctor(
        url,
        env('MATRIX_USER_TOKEN'),
        new SimpleFsStorageProvider('/tmp/live-user-store.json'),
        new RustSdkCryptoStorageProvider('/tmp/live-user-crypto', StoreType.Sqlite)
      );
      // The provider turns crypto on by default, so no flag is needed here.
      const provider = new MatrixProvider(
        { homeserverUrl: url, accessToken: env('MATRIX_BOT_TOKEN') },
        authStub
      );

      const received: ExternalMessage[] = [];
      provider.onMessage((m) => received.push(m));
      provider.onError(() => {});

      await user.start();
      await provider.connect();
      const botId = await new Ctor(url, env('MATRIX_BOT_TOKEN')).getUserId();
      const userId = await user.getUserId();

      try {
        const roomId = await user.createRoom({
          is_direct: true,
          invite: [botId],
          preset: 'trusted_private_chat',
        });
        await user.sendEvent(roomId, 'm.room.encryption', {
          algorithm: 'm.megolm.v1.aes-sha2',
        });
        await waitFor(async () =>
          (provider as any).joinedRooms.has(roomId) ? true : null
        );

        const { buffer, file } = await user.crypto.encryptMedia(PNG);
        const mxc = await user.uploadContent(buffer, 'application/octet-stream', 'secret.png');
        await user.sendMessage(roomId, {
          msgtype: 'm.image',
          body: 'encrypted picture',
          file: { ...file, url: mxc },
          info: { mimetype: 'image/png', size: PNG.length },
        });

        const inbound = await waitFor(
          async () => received.find((m) => (m.attachments?.length ?? 0) > 0) ?? null,
          40_000
        );
        expect(Buffer.from(inbound.attachments![0].data, 'base64')).toEqual(PNG);

        const decryptedByUser: any[] = [];
        user.on('room.message', (_room: string, event: any) => {
          if (event?.content?.msgtype === 'm.image' && event.sender !== userId) {
            decryptedByUser.push(event.content);
          }
        });

        await provider.sendMedia(roomId, {
          data: PNG,
          mimeType: 'image/png',
          fileName: 'chart.png',
          caption: 'encrypted send check',
        });

        // Reading the room over HTTP returns raw events, so an m.room.message
        // here would mean the image reached the homeserver in plaintext.
        const encryptedPost = await waitFor(
          async () =>
            (
              await latestMessages(user, roomId)
            ).find((e) => e.sender === botId && e.type === 'm.room.encrypted') ?? null,
          40_000
        );
        expect(encryptedPost.content.algorithm).toBe('m.megolm.v1.aes-sha2');
        expect(JSON.stringify(encryptedPost.content)).not.toContain('chart.png');

        const echoed = await waitFor(async () => decryptedByUser[0] ?? null, 40_000);
        expect(echoed.body).toBe('encrypted send check');
        expect(echoed.file?.v).toBeDefined();
        expect(echoed.url).toBeUndefined();
      } finally {
        await provider.disconnect();
        await user.stop();
      }
    },
    150_000
  );
});
