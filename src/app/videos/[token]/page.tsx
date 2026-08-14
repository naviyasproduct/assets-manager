import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { formatDate, formatBytes } from '@/lib/format';
import { bigIntToNumber } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PUBLIC watch page - reachable through the Cloudflare Tunnel because it sits
 * under /videos/*.
 *
 * This is what a PDF link opens: the repair video plus the write-up that goes
 * with it, so someone off-site gets context, not an unlabelled file download.
 * Access control is the unguessable token in the URL. It deliberately renders
 * standalone (its own <html>) so the authenticated app shell, navigation and
 * sign-out never appear on a publicly reachable page.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }> };

export default async function WatchPage({ params }: Props) {
  const { token } = await params;

  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();

  const fix = await prisma.machineFix.findUnique({
    where: { videoToken: token },
    include: {
      asset: {
        select: {
          assetTag: true,
          name: true,
          category: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
    },
  });

  if (!fix?.videoRelativePath || !fix.videoOriginalName) notFound();

  const fileUrl = `/videos/${token}/${encodeURIComponent(fix.videoOriginalName)}`;

  return (
    <main className="watch">
      <style>{watchStyles}</style>

      <header className="watch-header">
        <p className="watch-company">{config.branding.companyName}</p>
        <h1>{fix.title}</h1>
        <p className="watch-sub">
          {fix.asset.assetTag} · {fix.asset.name} · {fix.asset.department.name}
        </p>
      </header>

      <video className="watch-video" controls preload="metadata" playsInline>
        <source src={fileUrl} type={fix.videoMimeType ?? 'video/mp4'} />
        Your browser cannot play this video.{' '}
        <a href={fileUrl}>Download it instead.</a>
      </video>

      <dl className="watch-meta">
        <div>
          <dt>Fixed by</dt>
          <dd>{fix.fixedByName}</dd>
        </div>
        <div>
          <dt>Date of repair</dt>
          <dd>{formatDate(fix.fixedAt)}</dd>
        </div>
        <div>
          <dt>Equipment</dt>
          <dd>{fix.asset.category.name}</dd>
        </div>
        <div>
          <dt>File size</dt>
          <dd>{formatBytes(bigIntToNumber(fix.videoSizeBytes))}</dd>
        </div>
      </dl>

      {fix.symptom ? (
        <section className="watch-section">
          <h2>Symptom</h2>
          <p>{fix.symptom}</p>
        </section>
      ) : null}

      <section className="watch-section">
        <h2>What was done</h2>
        <p>{fix.description}</p>
      </section>

      <footer className="watch-footer">
        <a href={fileUrl} download>
          Download the original file
        </a>
      </footer>
    </main>
  );
}

const watchStyles = `
  .watch {
    max-width: 900px;
    margin: 0 auto;
    padding: 32px 20px 64px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #17202a;
  }
  .watch-header { border-bottom: 1px solid #e3e8ef; padding-bottom: 20px; margin-bottom: 24px; }
  .watch-company {
    margin: 0 0 10px; font-size: 11px; font-weight: 700; letter-spacing: .12em;
    text-transform: uppercase; color: #7a8699;
  }
  .watch-header h1 { margin: 0 0 6px; font-size: 26px; line-height: 1.25; font-weight: 650; }
  .watch-sub { margin: 0; font-size: 14px; color: #5b6879; }
  .watch-video {
    width: 100%; border-radius: 10px; background: #000; display: block;
    aspect-ratio: 16 / 9; margin-bottom: 24px;
  }
  .watch-meta {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 16px; margin: 0 0 28px; padding: 18px 20px;
    background: #f6f8fb; border: 1px solid #e3e8ef; border-radius: 10px;
  }
  .watch-meta div { margin: 0; }
  .watch-meta dt {
    font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: #7a8699; margin-bottom: 5px;
  }
  .watch-meta dd { margin: 0; font-size: 14px; font-weight: 550; }
  .watch-section { margin-bottom: 26px; }
  .watch-section h2 {
    font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: #7a8699; margin: 0 0 8px;
  }
  .watch-section p { margin: 0; font-size: 15px; line-height: 1.65; white-space: pre-wrap; }
  .watch-footer { border-top: 1px solid #e3e8ef; padding-top: 18px; font-size: 14px; }
  .watch-footer a { color: #1c5fd6; text-decoration: none; }
  .watch-footer a:hover { text-decoration: underline; }

  @media (prefers-color-scheme: dark) {
    .watch { color: #e8edf4; }
    .watch-header, .watch-footer { border-color: #2a3444; }
    .watch-meta { background: #161d28; border-color: #2a3444; }
    .watch-sub, .watch-company, .watch-meta dt, .watch-section h2 { color: #93a1b5; }
    .watch-footer a { color: #6ea8ff; }
  }
`;
