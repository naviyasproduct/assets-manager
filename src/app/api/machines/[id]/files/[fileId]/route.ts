import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { ok, fail, handleRouteError } from '@/lib/api';
import { loadMachineFacts } from '@/lib/machine';
import { fileResponse } from '@/lib/machine-files';
import { deleteQuietly } from '@/lib/video-storage';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; fileId: string }> };

async function findFile(machineId: string, fileId: string) {
  const file = await prisma.machineFixFile.findUnique({
    where: { id: fileId },
    select: {
      relativePath: true,
      mimeType: true,
      fileName: true,
      kind: true,
      fix: { select: { machineId: true } },
    },
  });
  // Scoped to the machine in the URL, so access to one never reaches another's files.
  return file && file.fix.machineId === machineId ? file : null;
}

/**
 * GET - the file for someone signed in. Videos and photos show in the page,
 * a PDF opens in the browser, Office files download. `?download` forces a save.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id, fileId } = await params;
    const user = await requireAccess('machines', 'VIEW');
    await loadMachineFacts(id, user);

    const file = await findFile(id, fileId);
    if (!file) return fail('File not found.', 404);

    const viewable = file.kind !== 'DOCUMENT' || file.mimeType === 'application/pdf';
    const download = new URL(request.url).searchParams.has('download');
    return fileResponse(request, file, viewable && !download ? 'inline' : 'attachment', 'private, max-age=86400');
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id, fileId } = await params;
    const user = await requireAccess('machines', 'EDIT');
    await loadMachineFacts(id, user);

    const file = await findFile(id, fileId);
    if (!file) return fail('File not found.', 404);

    await prisma.machineFixFile.delete({ where: { id: fileId } });
    // The file sits alone in its own folder; this removes both.
    await deleteQuietly(file.relativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
