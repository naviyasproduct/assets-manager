import 'server-only';
import puppeteer, { type Browser } from 'puppeteer';
import type { ReportData } from '@/lib/reports/data';
import {
  renderReportHtml,
  renderHeaderTemplate,
  renderFooterTemplate,
} from '@/lib/reports/template';

/**
 * Renders the report HTML to PDF.
 *
 * The browser is expensive to start (about a second) and the office PC runs this
 * on demand, so one instance is kept alive and reused across requests. Pages are
 * always closed; the browser is only torn down if it dies or the process exits.
 */

const globalForBrowser = globalThis as unknown as {
  reportBrowser?: Browser;
  reportBrowserPromise?: Promise<Browser>;
};

async function launchBrowser(): Promise<Browser> {
  // Puppeteer normally uses the Chromium it downloads at install time. On
  // locked-down office machines that download is often blocked by antivirus or
  // a proxy, so PUPPETEER_EXECUTABLE_PATH lets the admin point at an already
  // installed Chrome or Edge instead of fighting the download.
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;

  return puppeteer.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      // The office PC may run this as a service account with a small /dev/shm.
      '--disable-dev-shm-usage',
      '--disable-gpu',
      // Nothing in the report loads over the network, so the sandbox has no
      // untrusted content to contain - but keep it on where it works.
      '--no-first-run',
      '--no-default-browser-check',
      '--font-render-hinting=none',
    ],
  });
}

async function getBrowser(): Promise<Browser> {
  const existing = globalForBrowser.reportBrowser;
  if (existing?.connected) return existing;

  // Collapse concurrent cold starts into a single launch, so two department
  // heads clicking "Generate report" at once do not spawn two Chromiums.
  globalForBrowser.reportBrowserPromise ??= launchBrowser()
    .then((browser) => {
      globalForBrowser.reportBrowser = browser;
      browser.on('disconnected', () => {
        globalForBrowser.reportBrowser = undefined;
        globalForBrowser.reportBrowserPromise = undefined;
      });
      return browser;
    })
    .finally(() => {
      globalForBrowser.reportBrowserPromise = undefined;
    });

  return globalForBrowser.reportBrowserPromise;
}

export async function renderReportPdf(data: ReportData): Promise<Uint8Array> {
  return renderHtmlToPdf(renderReportHtml(data), {
    landscape: data.meta.config.orientation === 'LANDSCAPE',
    headerTemplate: renderHeaderTemplate(data),
    footerTemplate: renderFooterTemplate(data),
    fitTail: true,
  });
}

/** A4 at 96dpi, which is the unit Chrome lays print pages out in. */
const MM = 96 / 25.4;
const A4 = { width: 210 * MM, height: 297 * MM };

/**
 * How little may spill onto a final page before it is worth squeezing the
 * document to avoid that page, and how hard it may be squeezed. A quarter of
 * a page is about a sign-off block or a closing table; below 92% the type
 * starts to look different from every other report in the drawer.
 */
const TAIL_LIMIT = 0.3;
const MIN_SCALE = 0.92;

/**
 * Works out whether the document ends with a short tail on a page of its own,
 * and what scale would pull it back onto the page before.
 *
 * Measured in the page rather than counted in the PDF: Chrome lays the print
 * document out from the same box we can set the viewport to, so the height it
 * reports is the height it will paginate. Counting `/Type /Page` in the output
 * would be guessing at a format that is free to compress its own page tree.
 */
async function tailScale(
  page: import('puppeteer').Page,
  box: { width: number; height: number },
): Promise<number | null> {
  await page.setViewport({ width: Math.round(box.width), height: Math.round(box.height) });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);

  const pages = Math.ceil(height / box.height);
  if (pages < 2) return null;

  const tail = height - (pages - 1) * box.height;
  if (tail > box.height * TAIL_LIMIT) return null;

  // 0.995 keeps the last line off the boundary; rounding at the fold is what
  // turns "just fits" into "one more page".
  const scale = ((pages - 1) * box.height * 0.995) / height;
  return scale >= MIN_SCALE && scale < 1 ? scale : null;
}

/**
 * Any self-contained HTML document to an A4 PDF, on the shared browser. The
 * report and the purchase-order printout both come through here, so both get
 * the same network block and the same margins.
 */
export async function renderHtmlToPdf(
  html: string,
  options: {
    landscape?: boolean;
    headerTemplate?: string;
    footerTemplate?: string;
    /**
     * Squeeze the document slightly rather than let a short tail - a sign-off
     * block, a closing line - sit alone on a page of its own. Off by default:
     * the purchase-order printout is one page and has nothing to gain.
     */
    fitTail?: boolean;
  } = {},
): Promise<Uint8Array> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Block every outbound request. The documents are fully self-contained
    // (inlined CSS, base64 photos); if anything ever tries to reach the
    // network, it must fail fast rather than hang the render or leak internal
    // data.
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().startsWith('data:')) {
        void request.continue();
      } else if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        void request.continue();
      } else {
        void request.abort();
      }
    });

    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });

    // Force print media so @media print rules and background colours apply.
    await page.emulateMediaType('print');

    const withHeader = Boolean(options.headerTemplate || options.footerTemplate);
    const margin = withHeader
      ? { top: 20, bottom: 18, left: 14, right: 14 }
      : { top: 14, bottom: 14, left: 14, right: 14 };

    const paper = options.landscape ? { width: A4.height, height: A4.width } : A4;
    const scale = options.fitTail
      ? await tailScale(page, {
          width: paper.width - (margin.left + margin.right) * MM,
          height: paper.height - (margin.top + margin.bottom) * MM,
        })
      : null;

    return await page.pdf({
      format: 'A4',
      landscape: options.landscape ?? false,
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: withHeader,
      ...(withHeader
        ? {
            headerTemplate: options.headerTemplate ?? '<span></span>',
            footerTemplate: options.footerTemplate ?? '<span></span>',
          }
        : {}),
      ...(scale ? { scale } : {}),
      // Top/bottom leave room for the running header and footer.
      margin: {
        top: `${margin.top}mm`,
        bottom: `${margin.bottom}mm`,
        left: `${margin.left}mm`,
        right: `${margin.right}mm`,
      },
      timeout: 60_000,
    });
  } finally {
    await page.close().catch(() => {});
  }
}

/** Called by the pm2 shutdown hook so Chromium never outlives the app. */
export async function closeReportBrowser(): Promise<void> {
  const browser = globalForBrowser.reportBrowser;
  globalForBrowser.reportBrowser = undefined;
  globalForBrowser.reportBrowserPromise = undefined;
  await browser?.close().catch(() => {});
}

/** Filename staff will see in their downloads folder. */
export function reportFileName(data: ReportData): string {
  // The scope label already says what the report covers - "All departments",
  // one department's name, or "3 departments" - so the filename follows it
  // rather than keeping its own idea of the same thing.
  const scope =
    data.meta.scopeLabel.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Report';

  const date = data.meta.generatedAt.toISOString().slice(0, 10);
  return `Asset-Report_${scope}_${date}.pdf`;
}
