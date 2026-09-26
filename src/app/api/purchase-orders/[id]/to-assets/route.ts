import { prisma } from '@/lib/db';
import { requireAccess, assertDepartmentAccess, canAccessDepartment } from '@/lib/auth';
import { orderToAssetsSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { nextAssetTag } from '@/lib/asset-tag';
import { buildImageRelativePath, copyImage, imageMimeFor } from '@/lib/image-storage';
import { loadOrderFacts } from '@/lib/purchase-order';
import { decimalValue } from '@/lib/serialize';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * POST - lines that arrived, into the assets list. Each ticked line either
 * becomes a new asset (tag issued, bought price as its unit cost, the line's
 * photo copied over) or, when it was picked from an existing asset, tops that
 * asset's quantity up. Either way the line remembers which asset it went into,
 * and cannot be sent twice.
 *
 * Needs edit access to assets as well as a hand in the order, because this is
 * an asset write.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireAccess('assets', 'EDIT');
    const order = await loadOrderFacts(id, user, 'work');
    assertDepartmentAccess(user, order.departmentId);
    const body = orderToAssetsSchema.parse(await readJson(request));

    if (order.status !== 'COMPLETED') {
      return fail('Add items to the assets once the order is completed.', 409);
    }

    // The department the new assets are filed under. It may be a different one
    // from the order's, so it is checked on its own - being allowed to work an
    // order says nothing about being allowed to put equipment somewhere else.
    const departmentId = body.departmentId ?? order.departmentId;
    assertDepartmentAccess(user, departmentId);

    const full = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id },
      select: {
        number: true,
        completedAt: true,
        items: {
          include: {
            basedOnAsset: { select: { id: true, departmentId: true, photoRelativePath: true } },
          },
        },
      },
    });
    const lines = new Map(full.items.map((item) => [item.id, item]));

    // Every category named here or already on a line, so the checks below can
    // ask which department it belongs to without a query each.
    const wantedCategories = [
      ...new Set(
        body.items
          .map((pick) => pick.categoryId ?? lines.get(pick.id)?.categoryId)
          .filter(Boolean) as string[],
      ),
    ];
    const categoryDept = new Map(
      (
        await prisma.assetCategory.findMany({
          where: { id: { in: wantedCategories } },
          select: { id: true, departmentId: true },
        })
      ).map((category) => [category.id, category.departmentId]),
    );

    // Every problem is found before anything is written, so a bad tick does not
    // leave half the order converted.
    for (const pick of body.items) {
      const line = lines.get(pick.id);
      if (!line) return fail('One of those lines is not on this order.', 400);
      if (line.receivedAssetId) return fail(`"${line.name}" is already in the assets list.`, 409);
      const categoryId = pick.categoryId ?? line.categoryId;
      if (pick.mode === 'NEW' && !categoryId) {
        return fail(`Pick a category for "${line.name}" - every asset is filed under one.`, 400);
      }
      if (categoryId && !categoryDept.has(categoryId)) {
        return fail(`The category picked for "${line.name}" no longer exists.`, 400);
      }
      if (pick.mode === 'NEW' && categoryId && categoryDept.get(categoryId) !== departmentId) {
        return fail(
          `The category picked for "${line.name}" belongs to another department.`,
          400,
        );
      }
      // Assets are counted one by one. A line measured out in Kg or metres has
      // no whole thing to become, and rounding it would invent stock that was
      // never bought.
      if (!Number.isInteger(decimalValue(line.quantity))) {
        return fail(
          `"${line.name}" is ${decimalValue(line.quantity)} of something measured out, not a whole number of things, so it cannot become an asset.`,
          400,
        );
      }
      if (pick.mode === 'ADD_TO_EXISTING') {
        const asset = line.basedOnAsset;
        if (!asset) return fail(`"${line.name}" was not picked from an existing asset.`, 400);
        if (!canAccessDepartment(user, asset.departmentId)) {
          return fail(`The asset "${line.name}" was picked from is not one you can change.`, 403);
        }
      }
    }

    const photoCopies: Array<{ from: string; to: string; assetId: string }> = [];

    const made = await prisma.$transaction(async (tx) => {
      const out: Array<{ itemId: string; assetId: string; assetTag: string; mode: string }> = [];

      for (const pick of body.items) {
        const line = lines.get(pick.id)!;

        if (pick.mode === 'ADD_TO_EXISTING') {
          const asset = await tx.asset.update({
            where: { id: line.basedOnAsset!.id },
            data: { quantity: { increment: decimalValue(line.quantity) } },
            select: { id: true, assetTag: true },
          });
          await tx.purchaseOrderItem.update({
            where: { id: line.id },
            data: { receivedAssetId: asset.id },
          });
          out.push({ itemId: line.id, assetId: asset.id, assetTag: asset.assetTag, mode: pick.mode });
          continue;
        }

        const categoryId = (pick.categoryId ?? line.categoryId)!;
        const asset = await tx.asset.create({
          data: {
            assetTag: await nextAssetTag(tx, categoryId),
            name: line.name,
            quantity: decimalValue(line.quantity),
            categoryId,
            departmentId,
            locationId: pick.locationId ?? null,
            purchaseDate: full.completedAt,
            unitCost: line.boughtUnitPrice,
            notes: [line.details, `Bought on ${full.number}.`].filter(Boolean).join('\n\n'),
          },
          select: { id: true, assetTag: true },
        });
        await tx.purchaseOrderItem.update({
          where: { id: line.id },
          data: { receivedAssetId: asset.id },
        });

        const source = line.photoRelativePath ?? line.basedOnAsset?.photoRelativePath ?? null;
        if (source) {
          photoCopies.push({
            from: source,
            to: buildImageRelativePath(asset.id, imageMimeFor(source)),
            assetId: asset.id,
          });
        }
        out.push({ itemId: line.id, assetId: asset.id, assetTag: asset.assetTag, mode: pick.mode });
      }

      return out;
    });

    // Photos are copied after the rows commit: a file on disk cannot be rolled
    // back, and an asset without its photo is a far smaller problem than a
    // photo with no asset.
    for (const copy of photoCopies) {
      if (await copyImage(copy.from, copy.to)) {
        await prisma.asset.update({
          where: { id: copy.assetId },
          data: {
            photoRelativePath: copy.to,
            photoMimeType: imageMimeFor(copy.to),
            photoUploadedAt: new Date(),
          },
        });
      }
    }

    return ok({ assets: made }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
