import { prisma } from '@/lib/db';
import { statVideo, openVideoRange, mimeForPath } from '@/lib/video-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PUBLIC video streaming - the ONLY route reachable from outside the office.
 *
 * The Cloudflare Tunnel is scoped to /videos/* so nothing else here is exposed.
 * There is no session check on purpose: the CEO must be able to open a link from
 * a phone with no account. Authorisation is the URL itself - `token` is 24 random
 * bytes, generated per fix, and is not derivable from an asset or fix id.
 * Revoking access means deleting the video, which clears the token.
 *
 * Supports HTTP Range so mobile browsers can seek and start playback before the
 * whole file has transferred.
 */

type Params = { params: Promise<{ token: string; filename: string }> };

const NOT_FOUND = new Response('Not found', {
  status: 404,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
});

async function resolveVideo(token: string) {
  // Token format check first - cheap, and keeps junk out of the database.
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;

  const fix = await prisma.machineFix.findUnique({
    where: { videoToken: token },
    select: {
      videoRelativePath: true,
      videoMimeType: true,
      videoOriginalName: true,
    },
  });

  if (!fix?.videoRelativePath) return null;

  const stats = await statVideo(fix.videoRelativePath);
  if (!stats) return null;

  return { fix, stats };
}

function baseHeaders(mime: string, fileName: string | null): Record<string, string> {
  return {
    'content-type': mime,
    'accept-ranges': 'bytes',
    // `inline` so it plays in the browser rather than downloading.
    'content-disposition': `inline; filename="${(fileName ?? 'video').replace(/"/g, '')}"`,
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
    // This route is public by design, but it should never be embedded elsewhere.
    'x-frame-options': 'SAMEORIGIN',
    'x-robots-tag': 'noindex, nofollow',
  };
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { token } = await params;
    const resolved = await resolveVideo(token);
    if (!resolved) return NOT_FOUND;

    const { fix, stats } = resolved;
    const relativePath = fix.videoRelativePath!;
    const mime = fix.videoMimeType ?? mimeForPath(relativePath);
    const size = stats.size;
    const headers = baseHeaders(mime, fix.videoOriginalName);

    const rangeHeader = request.headers.get('range');

    if (!rangeHeader) {
      return new Response(openVideoRange(relativePath, 0, size - 1), {
        status: 200,
        headers: { ...headers, 'content-length': String(size) },
      });
    }

    // Only the single-range form `bytes=start-end` is supported; that is all any
    // browser media player actually sends.
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) {
      return new Response('Malformed Range header', {
        status: 416,
        headers: { 'content-range': `bytes */${size}` },
      });
    }

    const [, rawStart, rawEnd] = match;
    let start: number;
    let end: number;

    if (rawStart === '') {
      // Suffix form: `bytes=-500` means the last 500 bytes.
      const suffixLength = Number(rawEnd);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
        return new Response('Malformed Range header', {
          status: 416,
          headers: { 'content-range': `bytes */${size}` },
        });
      }
      start = Math.max(0, size - suffixLength);
      end = size - 1;
    } else {
      start = Number(rawStart);
      end = rawEnd === '' ? size - 1 : Number(rawEnd);
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      return new Response('Requested range not satisfiable', {
        status: 416,
        headers: { 'content-range': `bytes */${size}` },
      });
    }

    end = Math.min(end, size - 1);

    return new Response(openVideoRange(relativePath, start, end), {
      status: 206,
      headers: {
        ...headers,
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': String(end - start + 1),
      },
    });
  } catch (error) {
    console.error('[videos] stream error:', error);
    return NOT_FOUND;
  }
}

/** HEAD - players probe size and range support before requesting bytes. */
export async function HEAD(_request: Request, { params }: Params) {
  try {
    const { token } = await params;
    const resolved = await resolveVideo(token);
    if (!resolved) return new Response(null, { status: 404 });

    const { fix, stats } = resolved;
    const mime = fix.videoMimeType ?? mimeForPath(fix.videoRelativePath!);

    return new Response(null, {
      status: 200,
      headers: {
        ...baseHeaders(mime, fix.videoOriginalName),
        'content-length': String(stats.size),
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
