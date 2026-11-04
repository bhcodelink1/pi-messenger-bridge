/**
 * Media rules: mime resolution, size caps, and the photo-versus-document choice.
 *
 * These decide whether a chart reaches the phone as an inline preview, as a file
 * card, or with an error the model can act on, so the boundaries are worth
 * pinning down without a network.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_INBOUND_MAX_BYTES,
  DEFAULT_INBOUND_MAX_IMAGES,
  TELEGRAM_UPLOAD_MAX_BYTES,
  isInlinePhotoMime,
  mimeFromPath,
  readOutgoingMedia,
  resolveMediaSettings,
  sendMethodFor,
} from '../src/media';

describe('mimeFromPath', () => {
  it('maps a lowercase extension', () => {
    expect(mimeFromPath('/tmp/chart.png')).toBe('image/png');
  });

  it('maps an uppercase extension', () => {
    expect(mimeFromPath('/tmp/Chart.JPG')).toBe('image/jpeg');
  });

  it('returns undefined for an unknown extension', () => {
    expect(mimeFromPath('/tmp/notes.txt')).toBeUndefined();
  });
});

describe('isInlinePhotoMime', () => {
  it('accepts a format Telegram renders', () => {
    expect(isInlinePhotoMime('image/png')).toBe(true);
  });

  it('rejects SVG, which Telegram refuses in sendPhoto', () => {
    expect(isInlinePhotoMime('image/svg+xml')).toBe(false);
  });

  it('ignores a charset parameter', () => {
    expect(isInlinePhotoMime('image/jpeg;charset=binary')).toBe(true);
  });
});

describe('resolveMediaSettings', () => {
  it('fills defaults when the block is absent', () => {
    expect(resolveMediaSettings(undefined)).toEqual({
      enabled: true,
      maxBytes: DEFAULT_INBOUND_MAX_BYTES,
      maxImages: DEFAULT_INBOUND_MAX_IMAGES,
      sendMaxBytes: 50 * 1024 * 1024,
    });
  });

  it('keeps an explicit zero or negative value out of the result', () => {
    const settings = resolveMediaSettings({ maxBytes: 0, maxImages: -3 });
    expect(settings.maxBytes).toBe(DEFAULT_INBOUND_MAX_BYTES);
    expect(settings.maxImages).toBe(DEFAULT_INBOUND_MAX_IMAGES);
  });

  it('honours enabled false', () => {
    expect(resolveMediaSettings({ enabled: false }).enabled).toBe(false);
  });
});

describe('sendMethodFor', () => {
  it('uses sendPhoto for a small renderable image', () => {
    expect(sendMethodFor('image/png', 1024)).toBe('photo');
  });

  it('falls back to sendDocument above the 5 MB photo cap', () => {
    expect(sendMethodFor('image/png', TELEGRAM_UPLOAD_MAX_BYTES + 1)).toBe('document');
  });

  it('sends SVG as a document whatever its size', () => {
    expect(sendMethodFor('image/svg+xml', 1024)).toBe('document');
  });
});

describe('readOutgoingMedia', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads bytes, mime type, and file name', () => {
    const file = path.join(dir, 'chart.png');
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const media = readOutgoingMedia(file, 1024 * 1024);

    expect(media.mimeType).toBe('image/png');
    expect(media.fileName).toBe('chart.png');
    expect(media.data.length).toBe(4);
  });

  it('reports a missing file by absolute path', () => {
    expect(() => readOutgoingMedia(path.join(dir, 'nope.png'), 1024)).toThrow(
      /File not found/
    );
  });

  it('rejects a file over the limit and names both sizes', () => {
    const file = path.join(dir, 'big.png');
    fs.writeFileSync(file, Buffer.alloc(2048));

    expect(() => readOutgoingMedia(file, 1024)).toThrow(/File is 2 KB, over the 1 KB messenger limit/);
  });

  it('falls back to a generic mime type for an unknown extension', () => {
    const file = path.join(dir, 'data.bin');
    fs.writeFileSync(file, Buffer.from([1, 2, 3]));

    expect(readOutgoingMedia(file, 1024).mimeType).toBe('application/octet-stream');
  });
});
