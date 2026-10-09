import 'server-only';
import { prisma } from '@/lib/db';
import { config as appConfig } from '@/lib/config';
import { decimalToNumber, decimalValue } from '@/lib/serialize';
import { ORDER_STATUS_LABELS, SUPPLIER_KIND_LABELS, formatDate, formatMoney } from '@/lib/format';
import { readImageAsDataUri } from '@/lib/image-storage';

/**
 * The purchase order as paper: what the person doing the buying takes with
 * them. So it is arranged the way they will use it - one block per supplier,
 * with that supplier's address and numbers at the top and the lines to buy
 * there underneath, each with its details and a photo. It is kept as the
 * record of what was bought, so a price shows only once there is one - a new
 * order prints without money columns. Whoever is taking
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

/** "12 PCS", "2.25 Kg", "12". Trailing zeros off - 3.000 reads as 3. */
function formatQty(quantity: number, unit?: string | null): string {
  const amount = Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(3)));
  return unit ? `${amount} ${unit}` : amount;
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
      requestedBy: { select: { name: true, jobTitle: true } },
      issuedBy: { select: { name: true, jobTitle: true } },
      checkedBy: { select: { name: true, jobTitle: true } },
      authorizedBy: { select: { name: true, jobTitle: true } },
      items: {
        orderBy: { position: 'asc' },
        include: {
          category: { select: { name: true } },
          unit: { select: { name: true } },
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
          const qty = decimalValue(item.quantity);
          const photo = itemPhotos[index];
          // Most lines are typed in without a code; the line number keeps the
          // column from printing blank and still lets people point at a row.
          return `
        <tr>
          <td class="no">${item.codeNo ? esc(item.codeNo) : `<span class="muted">${index + 1}</span>`}</td>
          <td>
            <div>${esc(item.name)}</div>
            ${item.details ? `<div class="details">${esc(item.details)}</div>` : ''}
            ${item.basedOnAsset ? `<div class="muted">Same as ${esc(item.basedOnAsset.assetTag)}</div>` : ''}
            ${item.category ? `<div class="muted">${esc(item.category.name)}</div>` : ''}
          </td>
          <td class="pic">${photo ? `<img src="${photo}" alt="">` : '<div class="pic-empty"></div>'}</td>
          <td class="qty">${esc(formatQty(qty, item.unit?.name))}</td>
          ${
            priced
              ? `<td class="money">${unit === null ? '' : esc(formatMoney(unit))}</td><td class="money">${unit === null ? '' : esc(formatMoney(Math.round(unit * qty * 100) / 100))}</td>`
              : ''
          }
        </tr>`;
        })
        .join('');

      return `
      <section class="block">
        ${head}
        <table>
          <colgroup>
            <col style="width:10%"><col><col style="width:13%">
            <col style="width:11%">
            ${priced ? '<col style="width:12%"><col style="width:13%">' : ''}
          </colgroup>
          <thead><tr>
            <th>Code</th><th>Item &amp; details</th><th>Image</th><th class="qty">Qty</th>
            ${priced ? '<th class="money">Unit price</th><th class="money">Total</th>' : ''}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
    })
    .join('');

  const total = order.items.reduce((sum, item) => {
    const unit = decimalToNumber(item.boughtUnitPrice);
    if (unit === null) return sum;
    return sum + Math.round(unit * decimalValue(item.quantity) * 100) / 100;
  }, 0);

  // Oversea orders carry terms agreed with the shipper; a local one has none
  // of this and the block collapses to nothing.
  const termsHtml = (
    [
      ['From', order.originFrom],
      ['Attention', order.attention],
      ['Delivery', order.deliveryTerms],
      ['Payment', order.paymentTerms],
    ] as const
  )
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`)
    .join('');

  // The boxes at the foot. Where a name is on record it is printed above the
  // rule and the rule is left for the signature; where it is not, the box is
  // blank for someone to fill in by hand, which is what the paper always did.
  const signHtml = `
  <div class="sign">
    ${(
      [
        ['Requested by', order.requestedBy],
        ['Issued by', order.issuedBy],
        ['Checked by', order.checkedBy],
        ['Authorized by', order.authorizedBy],
      ] as const
    )
      .map(
        ([label, person]) =>
          `<div><div class="signed">${person ? esc(person.name) : '&nbsp;'}</div>${esc(label)}</div>`,
      )
      .join('')}
  </div>`;

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
  /* The owner asked for the item table in plain weight, headings included. */
  th { text-align: left; font-weight: 400; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .06em; color: #6b7688; padding: 5px 6px; border-bottom: 1px solid #dfe4ec; }
  td { padding: 6px; border-bottom: 1px solid #eef1f6; vertical-align: top; overflow-wrap: break-word; }
  tr { break-inside: avoid; }
  .details { font-size: 9pt; color: #3a4556; margin-top: 2px; white-space: pre-line; }
  .pic img, .pic-empty { width: 64px; height: 64px; border-radius: 4px; object-fit: cover; border: 1px solid #dfe4ec; display: block; }
  .pic-empty { background: #f4f6fa; }
  .qty { text-align: right; white-space: nowrap; }
  .money { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .total { text-align: right; margin-top: 12px; font-size: 11pt; }
  /* The gap above the rule is where the signature goes, so it has to be real. */
  .sign { display: flex; gap: 40px; margin-top: 64px; }
  .sign div { flex: 1; border-top: 1px solid #16202e; padding-top: 4px; font-size: 8.5pt; color: #6b7688; }
  .sign .signed { border: 0; padding: 0 0 2px; font-size: 9.5pt; color: #16202e; min-height: 13px; }
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
    <div><dt>Lines</dt><dd>${order.items.length}</dd></div>
    ${termsHtml}
  </dl>

  ${order.note ? `<div class="note">${esc(order.note)}</div>` : ''}

  <h2>Taken care of by</h2>
  <div class="people">${peopleHtml}</div>

  ${blockHtml}

  ${priced ? `<div class="total">Total bought <strong>${esc(formatMoney(total))}</strong></div>` : ''}

  ${signHtml}
</body></html>`;

  return { html, number: order.number };
}
