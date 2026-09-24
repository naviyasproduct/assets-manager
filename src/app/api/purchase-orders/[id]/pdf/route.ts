import { requireUser } from '@/lib/auth';
import { handleRouteError } from '@/lib/api';
import { loadOrderFacts } from '@/lib/purchase-order';
import { renderOrderHtml } from '@/lib/order-print';
import { renderHtmlToPdf } from '@/lib/reports/pdf';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * GET /api/purchase-orders/[id]/pdf - the order to hand to whoever is buying.
 * Anyone who may see the order may print it: the person assigned is exactly
 * who needs the paper copy. Shown inline so it opens in the browser's viewer
 * with its own Print button, rather than landing in Downloads.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireUser();
    await loadOrderFacts(id, user, 'see');

    const { html, number } = await renderOrderHtml(id);
    const pdf = await renderHtmlToPdf(html);

    return new Response(pdf as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(pdf.byteLength),
        'content-disposition': `inline; filename="${number}.pdf"`,
        // Prices and people change; always print what is true now.
        'cache-control': 'no-store, must-revalidate',
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
