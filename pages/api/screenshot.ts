import type { NextApiRequest, NextApiResponse } from 'next';
import * as puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { URL } from 'url'; // For robust URL parsing

// --- Types ---
interface ApiRequestBody {
  url: string;
  width: number;
  height: number;
  fullPage: boolean;
  // Add other options like format, quality, waitTime if needed
}

interface ApiResponseData {
  imageUrl?: string;
  message?: string;
  error?: string;
}

// --- Configuration ---
// Define where screenshots are saved within the public directory
const SCREENSHOT_DIR = path.join(process.cwd(), 'public', 'screenshots');
// Ensure the directory exists
fs.ensureDirSync(SCREENSHOT_DIR);

// Puppeteer launch options (taken from original server.js)
const puppeteerLaunchOptions = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
  ]
};

// --- API Handler ---
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponseData>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { url: rawUrl, width, height, fullPage = false }: ApiRequestBody = req.body;

  // --- Input Validation ---
  if (!rawUrl || !width || !height) {
    return res.status(400).json({ error: 'Missing required parameters: url, width, height.' });
  }
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
    return res.status(400).json({ error: 'Invalid dimensions. Width and height must be positive numbers.' });
  }
  if (typeof fullPage !== 'boolean') {
    return res.status(400).json({ error: 'Invalid fullPage value. Must be true or false.' });
  }

  // --- URL Normalization & Validation ---
  let url = rawUrl;
  if (!url.match(/^https?:\/\//)) {
    url = `https://${url}`;
  }

  let hostname = 'invalid-url';
  try {
    const parsedUrl = new URL(url);
    hostname = parsedUrl.hostname.replace(/^www\./, '');
    if (!hostname) throw new Error('Invalid hostname');
  } catch (error) {
    console.error(`Invalid URL provided: ${rawUrl} -> ${url}`, error);
    return res.status(400).json({ error: `Invalid URL format: ${rawUrl}` });
  }

  // --- Screenshot Logic ---
  let browser: puppeteer.Browser | null = null;
  const screenshotId = uuidv4();
  const filename = `${hostname}_${width}x${height}_${screenshotId}.png`; // Use PNG format
  const localFilePath = path.join(SCREENSHOT_DIR, filename);
  // Relative path for browser access (remove 'public')
  const publicImageUrl = `/screenshots/${filename}`;

  console.log(`[Screenshot API] Processing: ${url} at ${width}x${height} (FullPage: ${fullPage})`);

  try {
    console.log('[Screenshot API] Launching Puppeteer...');
    browser = await puppeteer.launch(puppeteerLaunchOptions);
    const page = await browser.newPage();
    console.log(`[Screenshot API] Puppeteer launched. Navigating to ${url}...`);

    await page.setViewport({ width, height });
    // Add timeout to prevent hanging indefinitely
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Optional wait time (could be passed in request body)
    // await new Promise(resolve => setTimeout(resolve, waitMs));

    console.log(`[Screenshot API] Taking screenshot (FullPage: ${fullPage})...`);
    await page.screenshot({
      path: localFilePath,
      fullPage: fullPage,
      type: 'png' // Specify type, default is png
    });

    console.log(`[Screenshot API] Screenshot saved to: ${localFilePath}`);
    console.log(`[Screenshot API] Public URL: ${publicImageUrl}`);

    await browser.close();
    browser = null;
    console.log('[Screenshot API] Browser closed.');

    // --- Success Response ---
    return res.status(200).json({ 
        message: 'Screenshot captured successfully.', 
        imageUrl: publicImageUrl 
    });

  } catch (error: any) {
    console.error(`[Screenshot API] Error processing ${url}:`, error);
    if (browser) {
        try {
            await browser.close();
            console.log('[Screenshot API] Browser closed after error.');
        } catch (closeError) {
            console.error('[Screenshot API] Error closing browser after initial error:', closeError);
        }
    }
    // Provide more specific error message if possible
    let errorMessage = 'Failed to capture screenshot.';
    if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
        errorMessage = `Could not resolve hostname: ${hostname}`;
    } else if (error.message.includes('TimeoutError')) {
        errorMessage = `Navigation timeout exceeded for ${url}`;
    }
    
    return res.status(500).json({ error: errorMessage, message: error.message });

  } finally {
    // Ensure browser is closed even if unexpected errors occur before explicit close
    if (browser) {
      try {
        await browser.close();
        console.log('[Screenshot API] Browser closed in finally block.');
      } catch (closeError) {
        console.error('[Screenshot API] Error closing browser in finally block:', closeError);
      }
    }
  }
} 