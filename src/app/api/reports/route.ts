import { requireUser } from '@/lib/auth';
import { reportRequestSchema } from '@/lib/validation';
import { buildReportData } from '@/lib/reports/data';
import { renderReportPdf, reportFileName } from '@/lib/reports/pdf';
import { fail, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';
// A company-wide report over a few hundred assets takes a few seconds; give
// Chromium generous headroom rather than risk a truncated download.
export const maxDuration = 300;

/**
 * POST /api/reports - generates the PDF on demand and streams it back.
 *
 * Returns the file directly rather than saving it anywhere: reports are a
 * snapshot of right now, and keeping stale PDFs on disk invites someone sending
 * the CEO last month's numbers.
 *
 * Scope is enforced inside buildReportData, which refuses a department the
 * caller cannot see rather than quietly narrowing to the ones they can.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const options = reportRequestSchema.parse(await readJson(request));

    const { data } = await buildReportData(user, options);
    const pdf = await renderReportPdf(data);

    return new Response(pdf as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(pdf.byteLength),
        'content-disposition': `attachment; filename="${reportFileName(data)}"`,
        // Always regenerate: an asset may have changed status seconds ago.
        'cache-control': 'no-store, must-revalidate',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'No departments matched this report.') {
      return fail('There is nothing to report on yet. Add a department first.', 400);
    }
    return handleRouteError(error);
  }
}
