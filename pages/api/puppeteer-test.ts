import type { NextApiRequest, NextApiResponse } from 'next';

// --- Types ---
export type PuppeteerTestResponse = {
  success: boolean;
  message: string;
  error?: string;
  details?: any;
};

const isVercelProduction = process.env.VERCEL === '1';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PuppeteerTestResponse>
) {
  console.log('[puppeteer-test] Endpoint hit.');
  let browser: any = null;
  try {
    let page: any;
    if (isVercelProduction) {
      console.log('[puppeteer-test] Importing puppeteer-core and @sparticuz/chromium...');
      const puppeteerCore = await import('puppeteer-core');
      const chromium = await import('@sparticuz/chromium');
      const executablePath = await chromium.default.executablePath();
      const launchOptions = {
        args: chromium.default.args,
        defaultViewport: { width: 1280, height: 720 },
        headless: chromium.default.headless,
        executablePath,
      };
      console.log('[puppeteer-test] About to launch puppeteer-core with options:', launchOptions);
      browser = await puppeteerCore.default.launch(launchOptions);
      page = await browser.newPage();
    } else {
      console.log('[puppeteer-test] Importing puppeteer...');
      const puppeteer = await import('puppeteer');
      const launchOptions = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      };
      console.log('[puppeteer-test] About to launch puppeteer with options:', launchOptions);
      browser = await puppeteer.default.launch(launchOptions);
      page = await browser.newPage();
    }
    console.log('[puppeteer-test] Browser launched, opening page...');
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const title = await page.title();
    console.log('[puppeteer-test] Page loaded. Title:', title);
    await browser.close();
    browser = null;
    return res.status(200).json({
      success: true,
      message: 'Puppeteer launched and navigated to example.com successfully.',
      details: { title },
    });
  } catch (error: any) {
    console.error('[puppeteer-test] Error:', error);
    if (browser) {
      try { await browser.close(); } catch {}
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to launch Puppeteer or navigate.',
      error: error?.message || String(error),
    });
  }
} 