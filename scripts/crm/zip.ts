import zlib from 'node:zlib';

/**
 * Just enough of the zip format to read a Rukovoditel backup.
 *
 * Deliberately not a dependency: the only zip libraries in node_modules belong
 * to Puppeteer, and a data migration for the office should not break the day
 * that package changes. These backups are written by PHP's ZipArchive - one
 * small deflated entry, no zip64, no encryption - which is the case below.
 */

export type ZipEntry = { name: string; data: Buffer };

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;

export function readZip(buffer: Buffer): ZipEntry[] {
  // The end record is last, after a comment of at most 64KB.
  let end = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 66_000; i--) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Not a zip file: no end-of-central-directory record.');

  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== CENTRAL_FILE_HEADER) {
      throw new Error(`Damaged zip: entry ${i + 1} of ${count} is not where the index says.`);
    }
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localHeader = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);

    // The local header repeats the name and extra field, at its own lengths.
    const localNameLength = buffer.readUInt16LE(localHeader + 26);
    const localExtraLength = buffer.readUInt16LE(localHeader + 28);
    const start = localHeader + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);

    if (method !== 0 && method !== 8) {
      throw new Error(`Unsupported compression in ${name} (method ${method}).`);
    }
    entries.push({ name, data: method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw) });

    at += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
