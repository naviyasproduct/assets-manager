import 'server-only';
import path from 'node:path';

/**
 * Central place for every environment-driven setting.
 *
 * Anything the office admin might need to change after deployment lives here so
 * it can be edited in one .env file rather than hunted through the codebase.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export const config = {
  sessionSecret: required('SESSION_SECRET'),

  /** Absolute path to the video storage root on the office PC's large disk. */
  videoStorageDir: path.resolve(optional('VIDEO_STORAGE_DIR', './videos')),

  maxVideoBytes: Number(optional('MAX_VIDEO_MB', '1024')) * 1024 * 1024,

  /**
   * Cloudflare Tunnel origin that publicly exposes ONLY /videos/*.
   * Empty string means the tunnel is not up yet, and PDF links fall back to the
   * LAN address (which only works inside the office).
   */
  publicVideoBaseUrl: stripTrailingSlash(optional('PUBLIC_VIDEO_BASE_URL', '')),

  lanBaseUrl: stripTrailingSlash(optional('LAN_BASE_URL', 'http://localhost:3000')),

  // Reports carry no logo - the company name is the identity. COMPANY_LOGO_PATH
  // is no longer read; leaving it here would be a setting that silently does
  // nothing.
  branding: {
    companyName: optional('COMPANY_NAME', 'Your Company'),
    tagline: optional('COMPANY_TAGLINE', 'Internal Asset & Purchase Planning'),
  },

  currency: {
    code: optional('CURRENCY_CODE', 'USD'),
    locale: optional('CURRENCY_LOCALE', 'en-US'),
  },

  isProduction: process.env.NODE_ENV === 'production',
} as const;

/**
 * Base used for anything under /videos/*.
 *
 * Prefers the Cloudflare Tunnel host so the CEO can open it from a phone off
 * site. Falls back to the LAN address when no tunnel is configured - still a
 * working link for anyone in the office.
 */
function videoBase(): string {
  return config.publicVideoBaseUrl || config.lanBaseUrl;
}

/**
 * The link printed in PDFs: a small watch page with a player and the write-up of
 * the repair, rather than a bare file download.
 */
export function buildVideoWatchUrl(videoToken: string): string {
  return `${videoBase()}/videos/${videoToken}`;
}

/** Direct file URL - what the <video> element on the watch page points at. */
export function buildVideoFileUrl(videoToken: string, fileName: string): string {
  return `${videoBase()}/videos/${videoToken}/${encodeURIComponent(fileName)}`;
}

/** True when video links in reports will actually work from outside the office. */
export function isPublicVideoAccessConfigured(): boolean {
  return config.publicVideoBaseUrl !== '';
}
