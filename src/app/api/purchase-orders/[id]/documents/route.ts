import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ok, fail, handleRouteError } from '@/lib/api';
import { loadOrderFacts } from '@/lib/purchase-order';
import {
  DocumentTooLargeError,
  MAX_DOCUMENT_BYTES,
  buildDocumentRelativePath,
  deleteDocumentQuietly,
  documentMimeFor,
  saveDocumentStream,
} from '@/lib/document-storage';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * POST - adds one document; the raw body is the file and `x-file-name` carries
 * its name, URI-encoded so non-English names survive the header. Whoever may
 * work the order may add one: the invoice usually comes back with the buyer.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    await loadOrderFacts(id, user, 'work');

    let fileName = '';
    try {
      fileName = decodeURIComponent(request.headers.get('x-file-name') ?? '').trim().slice(0, 200);
    } catch {
      return fail('The file name could not be read.', 400);
    }
    if (!fileName) return fail('The file has no name.', 400);

    const mimeType = documentMimeFor(fileName);
    if (!mimeType) return fail('Attach a PDF, Word or Excel file.', 415);

    if (Number(request.headers.get('content-length') ?? '0') > MAX_DOCUMENT_BYTES) {
      return fail(`That file is larger than the ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB limit.`, 413);
    }
    if (!request.body) return fail('No file was received.', 400);

    const relativePath = buildDocumentRelativePath(id, fileName);
    let sizeBytes: number;
    try {
      sizeBytes = (await saveDocumentStream(request.body, relativePath)).bytesWritten;
    } catch (error) {
      if (error instanceof DocumentTooLargeError) return fail(error.message, 413);
      throw error;
    }
    if (sizeBytes === 0) return fail('The file was empty.', 400);

    try {
      const document = await prisma.purchaseOrderDocument.create({
        data: { orderId: id, fileName, relativePath, mimeType, sizeBytes, uploadedById: user.id },
        select: { id: true },
      });
      return ok({ document }, 201);
    } catch (error) {
      await deleteDocumentQuietly(relativePath);
      throw error;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
