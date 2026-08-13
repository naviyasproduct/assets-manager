'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="login-page">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <h1 style={{ marginBottom: 8 }}>Something went wrong</h1>
        <p className="soft" style={{ marginTop: 0 }}>
          The page could not be loaded. If this keeps happening, check the server logs on the office
          PC with <code>pm2 logs assets-manager</code>.
        </p>
        {error.digest ? (
          <p className="muted" style={{ fontSize: 12 }}>
            Reference: {error.digest}
          </p>
        ) : null}
        <button type="button" className="btn btn-primary" onClick={reset} style={{ marginTop: 12 }}>
          Try again
        </button>
      </div>
    </main>
  );
}
