import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ok, fail, handleRouteError } from '@/lib/api';
import { loadOrderFacts } from '@/lib/purchase-order';
import { deleteDocumentQuietly, readDocument } from '@/lib/document-storage';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; documentId: string }> };

async function findDocument(orderId: string, documentId: string) {
  const document = await prisma.purchaseOrderDocument.findUnique({ where: { id: documentId } });
  // Scoped to the order in the URL, like the photos.
  return document && document.orderId === orderId ? document : null;
}

/** A PDF opens in the browser's viewer; Office files can only be downloaded. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id, documentId } = await params;
    const user = await requireUser();
    await loadOrderFacts(id, user, 'see');

    const document = await findDocument(id, documentId);
    if (!document) return fail('Document not found.', 404);

    const buffer = await readDocument(document.relativePath);
    if (!buffer) return fail('The file is missing from disk.', 404);

    const disposition = document.mimeType === 'application/pdf' ? 'inline' : 'attachment';
    const ascii = document.fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'content-type': document.mimeType,
        'content-length': String(buffer.byteLength),
        'content-disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id, documentId } = await params;
    const user = await requireUser();
    await loadOrderFacts(id, user, 'work');

    const document = await findDocument(id, documentId);
    if (!document) return fail('Document not found.', 404);

    await prisma.purchaseOrderDocument.delete({ where: { id: documentId } });
    await deleteDocumentQuietly(document.relativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
