'use client';

/**
 * Thin fetch wrapper shared by every form in the app.
 *
 * Returns a result object instead of throwing, because every caller needs to
 * render the message inline next to the form rather than blow up a boundary.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fields?: Record<string, string>; status: number };

export async function api<T = unknown>(
  url: string,
  init?: RequestInit & { json?: unknown },
): Promise<ApiResult<T>> {
  const { json, ...rest } = init ?? {};

  try {
    const response = await fetch(url, {
      ...rest,
      headers: {
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(rest.headers ?? {}),
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });

    // A 401 means the session expired while the tab was open. Send them back to
    // the login page rather than showing a confusing inline error.
    if (response.status === 401 && typeof window !== 'undefined') {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      return { ok: false, error: 'Your session expired.', status: 401 };
    }

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; fields?: Record<string, string> }
      | null;

    if (!response.ok) {
      return {
        ok: false,
        error: payload?.error ?? `Request failed (${response.status}).`,
        fields: payload?.fields,
        status: response.status,
      };
    }

    return { ok: true, data: payload as T };
  } catch {
    return {
      ok: false,
      error: 'Could not reach the server. Check that the office PC is switched on.',
      status: 0,
    };
  }
}

/**
 * Posts to /api/reports and hands the browser the resulting PDF.
 *
 * The response is a binary body, not JSON, so it cannot go through `api()`.
 */
export async function downloadReport(
  body: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: payload?.error ?? 'The report could not be generated.' };
    }

    const blob = await response.blob();

    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]+)"/.exec(disposition);
    const fileName = match?.[1] ?? 'asset-report.pdf';

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);

    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the server to generate the report.' };
  }
}

/**
 * Downscales an image in the browser before upload.
 *
 * Why bother: the same photo gets base64-inlined into every PDF that lists the
 * asset. A 4 MB phone photo across 40 assets would produce a report nobody can
 * email. Downscaling here keeps stored files at tens of kilobytes, which is far
 * more than enough for a 50px table thumbnail and a print-resolution copy in the
 * PDF - and it avoids a native image library on the office PC entirely.
 */
export async function downscaleImage(
  file: File,
  maxDimension = 640,
  quality = 0.82,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable.');

    // PNGs with transparency would otherwise composite onto black once encoded
    // as JPEG, which looks like a rendering fault in the report.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );

    if (!blob) throw new Error('Could not process that image.');
    return blob;
  } finally {
    bitmap.close();
  }
}

/** Downscales, then uploads an asset photo. */
export async function uploadAssetPhoto(
  assetId: string,
  file: File,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let blob: Blob;
  try {
    blob = await downscaleImage(file);
  } catch {
    return { ok: false, error: 'That file could not be read as an image.' };
  }

  try {
    const response = await fetch(`/api/assets/${assetId}/photo`, {
      method: 'PUT',
      headers: {
        'content-type': 'image/jpeg',
        'x-original-filename': file.name.replace(/[^\x20-\x7E]/g, '').slice(0, 120),
      },
      body: blob,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: payload?.error ?? `Upload failed (${response.status}).` };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the server to upload the photo.' };
  }
}

/**
 * Streams a video file with real progress. Uses XHR rather than fetch because
 * fetch still cannot report upload progress, and these files are large enough
 * that a silent 10-minute wait would look like a hang.
 */
export function uploadVideo(
  fixId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ ok: true; videoUrl: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const url = `/api/fixes/${fixId}/video?filename=${encodeURIComponent(file.name)}`;

    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', file.type || 'video/mp4');

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      let payload: { error?: string; videoUrl?: string } | null = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = null;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true, videoUrl: payload?.videoUrl ?? '' });
      } else {
        resolve({
          ok: false,
          error: payload?.error ?? `Upload failed (${xhr.status}).`,
        });
      }
    });

    xhr.addEventListener('error', () =>
      resolve({ ok: false, error: 'The upload failed. Check the network connection.' }),
    );
    xhr.addEventListener('abort', () =>
      resolve({ ok: false, error: 'The upload was cancelled.' }),
    );

    xhr.send(file);
  });
}
