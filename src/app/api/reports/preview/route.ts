import { requireUser } from '@/lib/auth';
import { reportRequestSchema } from '@/lib/validation';
import { buildReportData } from '@/lib/reports/data';
import { renderReportHtml } from '@/lib/reports/template';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * POST /api/reports/preview - the same document, as HTML, without Chromium.
 *
 * The builder calls this on every change, so it must be cheap: it skips the
 * PDF render entirely and hands back the HTML for an iframe. Rendering it
 * server-side rather than in the browser is what keeps the preview honest -
 * it is the identical template the PDF is made from, and the asset photos are
 * read from disk, which the browser cannot do.
 *
 * `candidates` is every row that matched the filters *before* the hand-picked
 * exclusions, which is what the tick lists in the builder are drawn from.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const options = reportRequestSchema.parse(await readJson(request));

    const { data, candidates } = await buildReportData(user, options, {
      preview: true,
      editable: options.editable,
    });

    return ok({
      html: renderReportHtml(data),
      candidates,
      totals: data.totals,
      warnings: data.meta.warnings,
      groups: data.groups.map((group) => ({
        key: group.key,
        label: group.label,
        assetCount: group.assetCount,
        purchaseCount: group.purchases.length,
        fixCount: group.fixes.length,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'No departments matched this report.') {
      return fail('There is nothing to report on yet. Add a department first.', 400);
    }
    return handleRouteError(error);
  }
}
