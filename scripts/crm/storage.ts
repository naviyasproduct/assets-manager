import fs from 'node:fs';
import path from 'node:path';

/** tsx does not read .env, and the photo folder is configured there. */
export function storageRoot(): string {
  let configured = process.env.VIDEO_STORAGE_DIR;
  if (!configured && fs.existsSync('.env')) {
    for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
      const match = /^\s*VIDEO_STORAGE_DIR\s*=\s*(.*)\s*$/.exec(line);
      if (match) configured = match[1].trim().replace(/^["']|["']$/g, '').replace(/\\\\/g, '\\');
    }
  }
  return path.resolve(configured || './videos');
}
