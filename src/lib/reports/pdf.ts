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
  });
}

/**
 * Any self-contained HTML document to an A4 PDF, on the shared browser. The
 * report and the purchase-order printout both come through here, so both get
 * the same network block and the same margins.
 */
export async function renderHtmlToPdf(
  html: string,
  options: { landscape?: boolean; headerTemplate?: string; footerTemplate?: string } = {},
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
      // Top/bottom leave room for the running header and footer.
      margin: withHeader
        ? { top: '20mm', bottom: '18mm', left: '14mm', right: '14mm' }
        : { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' },
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
