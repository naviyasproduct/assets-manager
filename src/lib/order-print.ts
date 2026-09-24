import 'server-only';
import { prisma } from '@/lib/db';
import { config as appConfig } from '@/lib/config';
import { decimalToNumber } from '@/lib/serialize';
import { ORDER_STATUS_LABELS, SUPPLIER_KIND_LABELS, formatDate, formatMoney } from '@/lib/format';
import { readImageAsDataUri } from '@/lib/image-storage';

/**
 * The purchase order as paper: what the person doing the buying takes with
 * them. So it is arranged the way they will use it - one block per supplier,
 * with that supplier's address and numbers at the top and the lines to buy
 * there underneath, each with a photo and a box to tick. Whoever is taking
 * care of it is on the top with their face and number, so the shop knows who
 * to expect and who to ring.
 *
 * Self-contained like the report: every photo is inlined, nothing is fetched,
 * and the PDF renderer blocks the network anyway.
 */

function esc(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}

/** Loads the order with the file paths the screen never sees, and inlines every photo. */
async function loadPrintable(orderId: string) {
  const order = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      department: { select: { name: true } },
      createdBy: { select: { name: true } },
      suppliers: { include: { supplier: true } },
      assignees: {
        include: {
          user: { select: { id: true, name: true, jobTitle: true, phone: true, photoRelativePath: true } },
        },
      },
      items: {
        orderBy: { position: 'asc' },
        include: {
          category: { select: { name: true } },
          basedOnAsset: { select: { assetTag: true, photoRelativePath: true } },
        },
      },
    },
  });

  // Read in parallel; a missing file just prints without its photo.
  const photo = (path: string | null | undefined) =>
    path ? readImageAsDataUri(path) : Promise.resolve(null);

  const [itemPhotos, supplierPhotos, peoplePhotos] = await Promise.all([
    Promise.all(
      order.items.map((item) => photo(item.photoRelativePath ?? item.basedOnAsset?.photoRelativePath)),
    ),
    Promise.all(order.suppliers.map(({ supplier }) => photo(supplier.photoRelativePath))),
    Promise.all(order.assignees.map(({ user }) => photo(user.photoRelativePath))),
  ]);

  return { order, itemPhotos, supplierPhotos, peoplePhotos };
}

export async function renderOrderHtml(orderId: string): Promise<{ html: string; number: string }> {
  const { order, itemPhotos, supplierPhotos, peoplePhotos } = await loadPrintable(orderId);

  const priced = order.items.some((item) => item.boughtUnitPrice !== null);
  const supplierPhoto = new Map(order.suppliers.map(({ supplier }, i) => [supplier.id, supplierPhotos[i]]));

  // One block per supplier on the order, in name order, then a block for the
  // lines nobody said where to buy.
  const suppliers = order.suppliers.map((s) => s.supplier).sort((a, b) => a.name.localeCompare(b.name));
  const blocks = [
    ...suppliers.map((supplier) => ({
      supplier,
      lines: order.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.supplierId === supplier.id),
    })),
    {
      supplier: null,
      lines: order.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !item.supplierId || !suppliers.some((s) => s.id === item.supplierId)),
    },
  ].filter((block) => block.lines.length > 0 || block.supplier);

  const people = order.assignees
    .map(({ user }, i) => ({ user, photo: peoplePhotos[i] }))
    .sort((a, b) => a.user.name.localeCompare(b.user.name));

  const peopleHtml =
    people.length === 0
      ? '<p class="muted">Nobody assigned.</p>'
      : people
          .map(
            ({ user, photo }) => `
      <div class="person">
        ${photo ? `<img class="face" src="${photo}" alt="">` : `<div class="face face-empty">${esc(initials(user.name))}</div>`}
        <div>
          <div class="person-name">${esc(user.name)}</div>
          ${user.jobTitle ? `<div class="muted">${esc(user.jobTitle)}</div>` : ''}
          ${user.phone ? `<div class="phone">${esc(user.phone)}</div>` : ''}
        </div>
      </div>`,
          )
          .join('');

  const blockHtml = blocks
    .map(({ supplier, lines }) => {
      const logo = supplier ? supplierPhoto.get(supplier.id) : null;
      const place = supplier ? [supplier.city, supplier.country].filter(Boolean).join(', ') : '';
      const head = supplier
        ? `
      <div class="supplier">
        ${logo ? `<img class="logo" src="${logo}" alt="">` : `<div class="logo logo-empty">${esc(supplier.name[0]?.toUpperCase() ?? '?')}</div>`}
        <div class="supplier-text">
          <div class="supplier-name">${esc(supplier.name)} <span class="kind">${esc(SUPPLIER_KIND_LABELS[supplier.kind])}</span></div>
          ${supplier.contactPerson ? `<div>Ask for <strong>${esc(supplier.contactPerson)}</strong></div>` : ''}
          ${supplier.address || place ? `<div>${esc([supplier.address, place].filter(Boolean).join(', '))}</div>` : ''}
          <div class="contact">
            ${[supplier.phone, supplier.altPhone].filter(Boolean).map((p) => `<span>☎ ${esc(p)}</span>`).join('')}
            ${supplier.email ? `<span>✉ ${esc(supplier.email)}</span>` : ''}
            ${supplier.website ? `<span>${esc(supplier.website)}</span>` : ''}
          </div>
          ${supplier.notes ? `<div class="muted notes">${esc(supplier.notes)}</div>` : ''}
        </div>
      </div>`
        : `<div class="supplier supplier-any"><div class="supplier-name">${suppliers.length > 0 ? 'Not tied to a supplier' : 'Items'}</div></div>`;

      if (lines.length === 0) {
        return `<section class="block">${head}<p class="muted" style="margin:8px 0 0">No lines marked for this supplier - see the other blocks.</p></section>`;
      }

      const rows = lines
        .map(({ item, index }) => {
          const unit = decimalToNumber(item.boughtUnitPrice);
          const photo = itemPhotos[index];
          return `
        <tr>
          <td class="no">${index + 1}</td>
          <td class="pic">${photo ? `<img src="${photo}" alt="">` : '<div class="pic-empty"></div>'}</td>
          <td>
            <div class="item">${esc(item.name)}</div>
            ${item.details ? `<div class="muted">${esc(item.details)}</div>` : ''}
            ${item.basedOnAsset ? `<div class="muted">Same as ${esc(item.basedOnAsset.assetTag)}</div>` : ''}
            ${item.category ? `<div class="muted">${esc(item.category.name)}</div>` : ''}
          </td>
          <td class="qty">${item.quantity}</td>
          ${
            priced
              ? `<td class="money">${unit === null ? '' : esc(formatMoney(unit))}</td><td class="money">${unit === null ? '' : esc(formatMoney(unit * item.quantity))}</td>`
              : `<td class="write"></td>`
          }
          <td class="tick"><span class="box"></span></td>
        </tr>`;
        })
        .join('');

      return `
      <section class="block">
        ${head}
        <table>
          <colgroup>
            <col style="width:5%"><col style="width:14%"><col>
            <col style="width:7%">
            ${priced ? '<col style="width:13%"><col style="width:14%">' : '<col style="width:18%">'}
            <col style="width:7%">
          </colgroup>
          <thead><tr>
            <th>#</th><th></th><th>Item</th><th class="qty">Qty</th>
            ${priced ? '<th class="money">Each</th><th class="money">Line</th>' : '<th>Price paid</th>'}
            <th class="tick">Got</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
    })
    .join('');

  const total = order.items.reduce((sum, item) => {
    const unit = decimalToNumber(item.boughtUnitPrice);
    return unit === null ? sum : sum + unit * item.quantity;
  }, 0);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(order.number)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #16202e; }
  .muted { color: #6b7688; font-size: 8.5pt; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1b3a6b; padding-bottom: 10px; }
  .company { font-size: 13pt; font-weight: 700; }
  .doc { text-align: right; }
  .doc .label { font-size: 8pt; letter-spacing: .12em; text-transform: uppercase; color: #6b7688; }
  .doc .number { font-family: Consolas, monospace; font-size: 18pt; font-weight: 700; color: #1b3a6b; }
  .facts { display: flex; gap: 22px; margin: 12px 0; font-size: 9pt; }
  .facts dt { color: #6b7688; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em; }
  .facts dd { margin: 1px 0 0; font-weight: 600; }
  .note { background: #f4f6fa; border-left: 3px solid #1b3a6b; padding: 7px 10px; margin: 0 0 12px; white-space: pre-line; }
  h2 { font-size: 9pt; letter-spacing: .1em; text-transform: uppercase; color: #6b7688; margin: 16px 0 8px; }
  .people { display: flex; flex-wrap: wrap; gap: 18px; }
  .person { display: flex; align-items: center; gap: 9px; }
  .face { width: 46px; height: 46px; border-radius: 50%; object-fit: cover; border: 1px solid #dfe4ec; }
  .face-empty { display: flex; align-items: center; justify-content: center; background: #eaf0fa; color: #1b3a6b; font-weight: 700; }
  .person-name { font-weight: 700; }
  .phone { font-weight: 600; }
  .block { margin-top: 14px; border: 1px solid #dfe4ec; border-radius: 6px; padding: 10px 12px; break-inside: avoid-page; }
  .supplier { display: flex; gap: 11px; align-items: flex-start; padding-bottom: 8px; border-bottom: 1px solid #eef1f6; }
  .supplier-any { border-bottom: 1px solid #eef1f6; }
  .logo { width: 48px; height: 48px; border-radius: 6px; object-fit: cover; border: 1px solid #dfe4ec; flex: 0 0 48px; }
  .logo-empty { display: flex; align-items: center; justify-content: center; background: #fbf2dc; color: #7a5f18; font-weight: 700; font-size: 16pt; }
  .supplier-name { font-size: 12pt; font-weight: 700; }
  .kind { font-size: 7.5pt; font-weight: 600; color: #6b7688; text-transform: uppercase; letter-spacing: .08em; margin-left: 6px; }
  .contact { display: flex; flex-wrap: wrap; gap: 12px; font-weight: 600; margin-top: 2px; }
  .notes { margin-top: 3px; white-space: pre-line; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 6px; }
  th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .06em; color: #6b7688; padding: 5px 6px; border-bottom: 1px solid #dfe4ec; }
  td { padding: 6px; border-bottom: 1px solid #eef1f6; vertical-align: top; overflow-wrap: break-word; }
  tr { break-inside: avoid; }
  .no { color: #6b7688; font-weight: 700; }
  .pic img, .pic-empty { width: 64px; height: 64px; border-radius: 4px; object-fit: cover; border: 1px solid #dfe4ec; display: block; }
  .pic-empty { background: #f4f6fa; }
  .item { font-weight: 700; }
  .qty { text-align: right; }
  td.qty { font-weight: 700; font-size: 11pt; }
  .money { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .write { border-bottom: 1px solid #b8c0cc; }
  .tick { text-align: center; }
  .box { display: inline-block; width: 16px; height: 16px; border: 1.5px solid #16202e; border-radius: 3px; }
  .total { text-align: right; margin-top: 12px; font-size: 11pt; }
  .sign { display: flex; gap: 40px; margin-top: 28px; }
  .sign div { flex: 1; border-top: 1px solid #16202e; padding-top: 4px; font-size: 8.5pt; color: #6b7688; }
</style></head>
<body>
  <div class="top">
    <div>
      <div class="company">${esc(appConfig.branding.companyName)}</div>
      ${appConfig.branding.tagline ? `<div class="muted">${esc(appConfig.branding.tagline)}</div>` : ''}
    </div>
    <div class="doc">
      <div class="label">Purchase order</div>
      <div class="number">${esc(order.number)}</div>
    </div>
  </div>

  <dl class="facts">
    <div><dt>Department</dt><dd>${esc(order.department.name)}</dd></div>
    <div><dt>Written</dt><dd>${esc(formatDate(order.createdAt))} by ${esc(order.createdBy.name)}</dd></div>
    ${order.sentAt ? `<div><dt>Sent out</dt><dd>${esc(formatDate(order.sentAt))}</dd></div>` : ''}
    <div><dt>Stage</dt><dd>${esc(ORDER_STATUS_LABELS[order.status])}</dd></div>
    <div><dt>Lines</dt><dd>${order.items.length} · ${order.items.reduce((n, i) => n + i.quantity, 0)} units</dd></div>
  </dl>

  ${order.note ? `<div class="note">${esc(order.note)}</div>` : ''}

  <h2>Taken care of by</h2>
  <div class="people">${peopleHtml}</div>

  <h2>What to buy</h2>
  ${blockHtml}

  ${priced ? `<div class="total">Total bought <strong>${esc(formatMoney(total))}</strong></div>` : ''}

  <div class="sign">
    <div>Bought by</div>
    <div>Date</div>
    <div>Received by</div>
  </div>
</body></html>`;

  return { html, number: order.number };
}
