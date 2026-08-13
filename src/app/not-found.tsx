import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="login-page">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <h1 style={{ marginBottom: 8 }}>Not found</h1>
        <p className="soft" style={{ marginTop: 0 }}>
          That page does not exist, or you do not have access to it.
        </p>
        <Link href="/" className="btn btn-primary" style={{ marginTop: 12 }}>
          Back to overview
        </Link>
      </div>
    </main>
  );
}
