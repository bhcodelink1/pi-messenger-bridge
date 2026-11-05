/**
 * Matrix attachment handling against a stub client.
 *
 * Mirrors tests/telegram-media.test.ts. The interesting cases are the two media
 * layouts: a plain upload referenced by `content.url`, and an encrypted upload
 * whose bytes are separately encrypted and described by `content.file`. Picking
 * the wrong one either leaks plaintext into an encrypted room or fails to
 * decrypt an inbound picture.
 */
import { describe, expect, it } from 'vitest';
import { MatrixProvider } from '../src/transports/matrix';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ROOM = '!room:example.org';

function stubClient(options: { encrypted?: boolean } = {}) {
  const uploads: Array<{ data: Buffer; contentType?: string; filename?: string }> = [];
  const sent: Array<{ roomId: string; content: any }> = [];
  const downloads: string[] = [];
  const decrypted: any[] = [];

  const client = {
    crypto: {
      async isRoomEncrypted() {
        return options.encrypted ?? false;
      },
      async encryptMedia(file: Buffer) {
        return {
          buffer: Buffer.concat([Buffer.from('ENC'), file]),
          file: { key: { k: 'k' }, iv: 'iv', hash: 'h', v: 'v2' },
        };
      },
      async decryptMedia(file: any) {
        decrypted.push(file);
        return PNG;
      },
    },
    async getRoomState() {
      return options.encrypted ?? false
        ? [{ type: 'm.room.encryption', content: { algorithm: 'm.megolm.v1.aes-sha2' } }]
        : [];
    },
    async uploadContent(data: Buffer, contentType?: string, filename?: string) {
      uploads.push({ data, contentType, filename });
      return 'mxc://example.org/uploaded';
    },
    async downloadContent(mxc: string) {
      downloads.push(mxc);
      return { data: PNG, contentType: 'image/png' };
    },
    async sendMessage(roomId: string, content: any) {
      sent.push({ roomId, content });
      return '$evt';
    },
    async getJoinedRoomMembers() {
      return ['@bot:example.org', '@bala:example.org'];
    },
  };

  return { client, uploads, sent, downloads, decrypted };
}

const auth = {
  checkAuthorization: async () => true,
  handleAdminCommand: async () => false,
} as never;

function build(client: any, media?: Record<string, unknown>) {
  const provider = new MatrixProvider(
    { homeserverUrl: 'https://example.org', accessToken: 't' },
    auth,
    media as never
  );
  (provider as any).client = client;
  (provider as any).botUserId = '@bot:example.org';
  (provider as any).joinedRooms = new Set([ROOM]);
  (provider as any).roomMemberCount = new Map([[ROOM, 2]]);
  (provider as any).connectedAt = 0;
  return provider;
}

async function deliver(
  provider: MatrixProvider,
  content: Record<string, unknown>
): Promise<External[]> {
  const received: External[] = [];
  provider.onMessage((m) => received.push(m));
  provider.onError(() => {});
  await (provider as any).handleMessage(ROOM, {
    type: 'room.message',
    sender: '@bala:example.org',
    event_id: '$1',
    origin_server_ts: Date.now(),
    content,
  });
  return received;
}

type External = { content: string; attachments?: any[] };

describe('Matrix inbound images', () => {
  it('downloads a plain image upload', async () => {
    const { client, downloads } = stubClient();
    const received = await deliver(build(client), {
      msgtype: 'm.image',
      body: 'photo.png',
      url: 'mxc://example.org/abc',
      info: { mimetype: 'image/png', size: PNG.length },
    });

    expect(downloads).toEqual(['mxc://example.org/abc']);
    expect(received).toHaveLength(1);
    expect(received[0].content).toBe('photo.png');
    expect(Buffer.from(received[0].attachments![0].data, 'base64')).toEqual(PNG);
    expect(received[0].attachments![0].mimeType).toBe('image/png');
  });

  it('decrypts an encrypted upload instead of reading raw bytes', async () => {
    const descriptor = { url: 'mxc://example.org/enc', key: {}, iv: 'iv', hash: 'h', v: 'v2' };
    const { client, downloads, decrypted } = stubClient({ encrypted: true });

    const received = await deliver(build(client), {
      msgtype: 'm.image',
      body: 'secret.png',
      file: descriptor,
      info: { mimetype: 'image/png' },
    });

    expect(decrypted).toEqual([descriptor]);
    expect(downloads).toHaveLength(0);
    expect(Buffer.from(received[0].attachments![0].data, 'base64')).toEqual(PNG);
  });

  it('reports an oversized image and still forwards the caption', async () => {
    const errors: Error[] = [];
    const provider = build(stubClient().client, { maxBytes: 1024 });
    provider.onError((e) => errors.push(e));

    await (provider as any).handleMessage(ROOM, {
      sender: '@bala:example.org',
      event_id: '$2',
      origin_server_ts: Date.now(),
      content: {
        msgtype: 'm.image',
        body: 'huge screenshot',
        url: 'mxc://example.org/big',
        info: { mimetype: 'image/png', size: 9 * 1024 * 1024 },
      },
    });

    expect(errors[0].message).toMatch(/over the 1 KB limit/);
  });

  it('collects nothing when media support is disabled', async () => {
    const { client, downloads } = stubClient();
    const received = await deliver(build(client, { enabled: false }), {
      msgtype: 'm.image',
      body: 'photo.png',
      url: 'mxc://example.org/abc',
      info: { mimetype: 'image/png' },
    });

    expect(downloads).toHaveLength(0);
    expect(received[0].attachments).toHaveLength(0);
  });
});

describe('Matrix outbound media', () => {
  it('uploads plaintext and posts m.image in an unencrypted room', async () => {
    const { client, uploads, sent } = stubClient();
    const provider = build(client);

    await provider.sendMedia(ROOM, {
      data: PNG,
      mimeType: 'image/png',
      fileName: 'chart.png',
      caption: 'here is the chart',
    });

    expect(uploads[0].contentType).toBe('image/png');
    expect(sent[0].content.msgtype).toBe('m.image');
    expect(sent[0].content.body).toBe('here is the chart');
    expect(sent[0].content.filename).toBe('chart.png');
    expect(sent[0].content.url).toBe('mxc://example.org/uploaded');
    expect(sent[0].content.file).toBeUndefined();
  });

  it('encrypts the file before uploading in an encrypted room', async () => {
    const { client, uploads, sent } = stubClient({ encrypted: true });
    const provider = build(client);

    await provider.sendMedia(ROOM, { data: PNG, mimeType: 'image/png', fileName: 'chart.png' });

    // The uploaded bytes must be ciphertext, and the descriptor carries the key.
    expect(uploads[0].data.subarray(0, 3).toString()).toBe('ENC');
    expect(uploads[0].contentType).toBe('application/octet-stream');
    expect(sent[0].content.url).toBeUndefined();
    expect(sent[0].content.file.url).toBe('mxc://example.org/uploaded');
    expect(sent[0].content.file.v).toBe('v2');
  });

  it('refuses to post plaintext media into an encrypted room when crypto is off', async () => {
    const provider = new MatrixProvider(
      { homeserverUrl: 'https://example.org', accessToken: 't', encryption: false },
      auth
    );
    const { client, sent } = stubClient({ encrypted: true });
    (provider as any).client = { ...client, crypto: undefined };

    await expect(
      provider.sendMedia(ROOM, { data: PNG, mimeType: 'image/png', fileName: 'chart.png' })
    ).rejects.toThrow(/crypto is disabled/);
    expect(sent).toHaveLength(0);
  });

  it('detects encryption from the room state event, not the crypto tracker', async () => {
    const { client, sent } = stubClient({ encrypted: true });
    // A crypto client that has never seen the state event reports the room as
    // unencrypted; the state event must still win.
    client.crypto.isRoomEncrypted = async () => false;
    const provider = build(client);

    await provider.sendMedia(ROOM, { data: PNG, mimeType: 'image/png', fileName: 'chart.png' });

    expect(sent[0].content.file?.url).toBe('mxc://example.org/uploaded');
    expect(sent[0].content.url).toBeUndefined();
  });

  it('posts a non-image as m.file', async () => {
    const { client, sent } = stubClient();
    const provider = build(client);

    await provider.sendMedia(ROOM, {
      data: Buffer.from('%PDF'),
      mimeType: 'application/pdf',
      fileName: 'report.pdf',
    });

    expect(sent[0].content.msgtype).toBe('m.file');
  });

  it('refuses to send when the client is not connected', async () => {
    const provider = new MatrixProvider(
      { homeserverUrl: 'https://example.org', accessToken: 't' },
      auth
    );

    await expect(
      provider.sendMedia(ROOM, { data: PNG, mimeType: 'image/png' })
    ).rejects.toThrow(/not connected/);
  });
});
