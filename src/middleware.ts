import { NextResponse, type NextRequest } from 'next/server';

/**
 * Two jobs, both cheap enough for the edge runtime:
 *
 *  1. Bounce anonymous browsers to /login before a page renders.
 *  2. Make sure the Cloudflare Tunnel can only ever reach /videos/*.
 *
 * This is a gate, not the authorisation system. It cannot touch the database
 * (Prisma does not run on the edge), so it only checks that a session cookie is
 * *present*. Every route handler and server component independently verifies the
 * session and the department scope - that is where real access control lives.
 */

const SESSION_COOKIE = 'am_session';

/** Reachable without signing in. */
const PUBLIC_PATHS = ['/login', '/api/auth/login'];

/** Publicly reachable AND allowed through the Cloudflare Tunnel. */
function isVideoPath(pathname: string): boolean {
  return pathname === '/videos' || pathname.startsWith('/videos/');
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Tunnel containment -------------------------------------------------
  // Requests arriving via Cloudflare carry these headers. The tunnel config
  // already restricts ingress to /videos/*, but if that config is ever edited
  // wrongly, this stops the whole internal app from becoming internet-facing.
  const viaCloudflare =
    request.headers.has('cf-ray') || request.headers.has('cf-connecting-ip');

  if (viaCloudflare && !isVideoPath(pathname)) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  if (isVideoPath(pathname)) {
    return NextResponse.next();
  }

  // --- Session gate -------------------------------------------------------
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (isPublicPath(pathname)) {
    // Already signed in? Skip the login form.
    if (hasSession && pathname === '/login') {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    // API callers get a JSON 401 rather than an HTML redirect they cannot parse.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
    }

    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') {
      loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next's own static output and the favicon.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
