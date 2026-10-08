import { NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth';
import { ok, fail, handleRouteError } from '@/lib/api';
import {
  buildImportTemplate,
  commitImport,
  planImport,
  readImportSheet,
  SheetError,
} from '@/lib/asset-import';
import { ASSET_IMPORT_MAX_BYTES, assetImportModeSchema } from '@/lib/validation';

export const runtime = 'nodejs';

/** GET /api/assets/import - the blank sheet, with today's lists in its dropdowns. */
export async function GET() {
  try {
    const user = await requireAccess('assets', 'EDIT');
    const file = await buildImportTemplate(user);
    const stamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(new Uint8Array(file), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="asset-import-sheet-${stamp}.xlsx"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/assets/import  (multipart: file, mode = check | import)
 *
 * `check` answers with the report and writes nothing. `import` reads the sheet
 * again from scratch and writes every row or none; the browser sends the same
 * file twice rather than the server holding anything between the two.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAccess('assets', 'EDIT');

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail('Choose the filled-in Excel sheet first.', 400);
    }

    const mode = assetImportModeSchema.parse(form.get('mode') ?? 'check');
    const file = form.get('file');
    if (!file || typeof file === 'string' || file.size === 0) {
      return fail('Choose the filled-in Excel sheet first.', 400);
    }
    if (file.size > ASSET_IMPORT_MAX_BYTES) {
      return fail('That file is over 5 MB. Split the assets across smaller sheets.', 413);
    }

    let rows;
    try {
      rows = await readImportSheet(await file.arrayBuffer());
    } catch (error) {
      if (error instanceof SheetError) return fail(error.message, 422);
      throw error;
    }

    const { report, plan } = await planImport(user, rows);
    if (mode === 'check') return ok({ report });

    if (report.problemCount > 0) {
      return fail(
        `Nothing was added: ${report.problemCount} row${report.problemCount === 1 ? '' : 's'} ` +
          'still need correcting. Choose the sheet again to see which.',
        422,
      );
    }

    const created = await commitImport(user, plan);
    return ok({ created: created.length, tags: created.map((asset) => asset.assetTag) }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
