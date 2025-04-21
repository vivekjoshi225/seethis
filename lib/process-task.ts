import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs-extra';
import { URL } from 'url';
import taskStore from '@/lib/task-store';
import { ScreenshotTask, ScreenshotJob, TaskStatus } from '@/types/screenshot';

// TODO: Move puppeteer launch options here or to a shared config
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

// Timeout for Puppeteer page navigation
const NAVIGATION_TIMEOUT = 60000; // 60 seconds

const SCREENSHOTS_DIR = path.join(process.cwd(), 'screenshots');
const MAX_CONCURRENT_PAGES = 5;

// --- Helper Function to Parse Dimension String --- 
function parseDimension(dimension: string): { width: number, height: number } | null {
  const match = dimension.match(/^(\d+)x(\d+)$/);
  if (match && match[1] && match[2]) {
    const width = parseInt(match[1], 10);
    const height = parseInt(match[2], 10);
    if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }
  return null;
}

// --- Helper: Sanitize URL parts for filename ---
function sanitizeForFilename(text: string): string {
    // Remove protocol, replace common invalid chars with underscore
    // Keep dots for domain, replace slashes in path
    return text
        .replace(/^https?:\/\//, '')
        .replace(/\//g, '_') // Replace slashes with underscore
        .replace(/[^a-zA-Z0-9_.-]/g, '') // Remove other invalid chars
        .substring(0, 100); // Limit length to prevent excessively long names
}

// --- Helper: Generate descriptive filename ---
function generateScreenshotFilename(url: string, dimension: string, type: 'viewport' | 'fullPage'): string {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.replace(/^www\./, ''); // Remove www.
        let pathSegment = urlObj.pathname;

        // Clean up path segment
        if (pathSegment === '/' || pathSegment === '') {
            pathSegment = 'home'; // Use 'home' for root path
        } else {
            // Remove leading/trailing slashes and sanitize
            pathSegment = sanitizeForFilename(pathSegment.replace(/^\/|\/$/g, '')); 
        }

        // Construct filename: domain_path_dimension_type.png
        const safeHostname = sanitizeForFilename(hostname);
        const filename = `${safeHostname}_${pathSegment}_${dimension}_${type}.png`;
        
        // Further truncate if somehow still too long (should be rare)
        return filename.length > 200 ? filename.substring(0, 196) + '.png' : filename;

    } catch (error) {
        console.error(`Error parsing URL for filename: ${url}`, error);
        // Fallback filename if URL parsing fails
        const fallbackName = `${sanitizeForFilename(url)}_${dimension}_${type}`.substring(0, 196);
        return `${fallbackName}.png`;
    }
}

async function processSingleJob(job: ScreenshotJob, task: ScreenshotTask, page: Page): Promise<Partial<ScreenshotJob>> {
    // Extract data, including waitMs
    const { url: rawUrl, dimension, screenshotType, id: jobId, waitMs: initialWaitMs } = job; // Rename to avoid conflict
    const { taskId, taskSpecificDir } = task;

    // --- Parse Dimensions ---
    const parsedDim = parseDimension(dimension);
    if (!parsedDim) {
        console.error(`[Task ${taskId}] Invalid dimension format for job ${jobId}: ${dimension}`);
        return { status: 'error', message: `Invalid dimension format: ${dimension}. Expected WxH.` };
    }
    const { width, height } = parsedDim;

    // --- URL Normalization & Validation ---
    let url = rawUrl;
    if (!url.match(/^https?:\/\//)) {
        url = `https://${url}`;
    }
    let hostname = 'invalid-url';
    try {
        const parsedUrl = new URL(url);
        hostname = parsedUrl.hostname.replace(/^www\./, ''); 
        if (!hostname) throw new Error('Invalid hostname after parsing');
    } catch (error: any) {
        console.error(`[Task ${taskId}] Invalid URL for job ${jobId}: ${rawUrl}`, error);
        return { status: 'error', message: `Invalid URL format: ${error.message || 'Unknown URL error'}` };
    }

    // --- Screenshot Logic ---
    const filename = generateScreenshotFilename(url, dimension, screenshotType);
    const localFilePath = path.join(taskSpecificDir, filename);
    const publicImageUrl = `/task_screenshots/${taskId}/${filename}`;

    try {
        // Cap the wait time at 7000ms as a final safeguard
        const waitMs = Math.min(initialWaitMs || 0, 7000);

        console.log(`[Task ${taskId}] Processing job ${jobId}: ${url} (${dimension}, ${screenshotType}, wait: ${waitMs}ms)`);
        
        await page.setViewport({ width, height });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT });

        // --- Add Delay if specified (using the capped value) ---
        if (waitMs > 0) { // No need for waitMs && check as it's handled by || 0
            console.log(`[Task ${taskId}] Waiting ${waitMs}ms for job ${jobId}...`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
            console.log(`[Task ${taskId}] Wait finished for job ${jobId}.`);
        }
        // --- End Delay ---

        const isFullPage = screenshotType === 'fullPage';
        await page.screenshot({
            path: localFilePath,
            fullPage: isFullPage,
            type: 'png'
        });

        console.log(`[Task ${taskId}] Screenshot saved for job ${jobId}: ${localFilePath}`);
        return { status: 'completed', imageUrl: publicImageUrl };

    } catch (error: any) {
        console.error(`[Task ${taskId}] Error processing job ${jobId} (${url}):`, error);
        let errorMessage = 'Failed to capture screenshot.';
        if (error instanceof Error) {
            if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
                errorMessage = `Could not resolve hostname: ${hostname}`;
            } else if (error.name === 'TimeoutError' || error.message.includes('Timeout')) {
                // Distinguish between navigation and potential wait timeout (though wait doesn't timeout here)
                errorMessage = 'Page navigation timeout'; 
            } else if (error.message.includes('Invalid URL')) {
                errorMessage = 'Invalid URL provided'; 
            }
            errorMessage = `${errorMessage} (${error.message})`;
        } else {
             errorMessage = `An unknown error occurred: ${String(error)}`;
        }
        return { status: 'error', message: errorMessage };
    }
}

export async function processScreenshotTask(taskId: string): Promise<void> {
    // Initial task fetch
    let task = taskStore.get(taskId);
    if (!task) {
        console.error(`[Process Task] Task ${taskId} not found in store.`);
        return;
    }

    // Initial status check
    if (task.status !== 'pending' && task.status !== 'processing') {
        console.warn(`[Process Task] Task ${taskId} has status ${task.status}, skipping processing.`);
        return;
    }

    // Set to processing
    task.status = 'processing';
    taskStore.set(taskId, { ...task });
    console.log(`[Process Task] Starting processing for task ${taskId} with ${task.jobs.length} jobs.`);

    let browser: Browser | null = null;
    let completedCount = 0;
    let errorCount = 0;
    let wasCancelled = false; // Flag to track cancellation

    try {
        console.log(`[Task ${taskId}] Launching Puppeteer...`);
        browser = await puppeteer.launch(puppeteerLaunchOptions);
        const page: Page = await browser.newPage();
        console.log(`[Task ${taskId}] Puppeteer launched.`);

        for (let i = 0; i < task.jobs.length; i++) {
             // --- Check for cancellation before processing each job ---
            const latestTaskState = taskStore.get(taskId); // Get the *latest* state
            if (!latestTaskState) { // Should not happen, but safety check
                 console.error(`[Task ${taskId}] Task disappeared from store mid-processing.`);
                 wasCancelled = true; // Treat as cancelled/error
                 task.status = 'error';
                 task.error = 'Task state lost during processing.';
                 break; 
            }
            if (latestTaskState.status === 'cancelling' || latestTaskState.status === 'cancelled') {
                console.log(`[Task ${taskId}] Cancellation detected. Stopping job processing.`);
                wasCancelled = true;
                task.status = 'cancelled'; // Set final status to cancelled
                break; // Exit the job processing loop
            }
            // --- End cancellation check ---

            // Get the specific job to process
            const currentJob = task.jobs[i]; 

            // Check job status (redundant if always starts pending, but safe)
            if (currentJob.status !== 'pending') {
                console.warn(`[Task ${taskId}] Skipping job ${currentJob.id} with status ${currentJob.status}`);
                if (currentJob.status === 'completed') completedCount++;
                if (currentJob.status === 'error') errorCount++;
                continue;
            }

            // Update job status to processing
            task.jobs[i].status = 'processing';
            taskStore.set(taskId, { ...task }); // Update store

            // Process the job
            const result = await processSingleJob(currentJob, task, page);

            // Update job result in the task object held by this process
            // Re-fetch task state before update? Maybe not needed if sequential
            task.jobs[i] = { ...currentJob, ...result };

            // Update counts
            if (task.jobs[i].status === 'completed') {
                completedCount++;
            } else if (task.jobs[i].status === 'error') {
                errorCount++;
            }

            // Update store with the latest job result
            taskStore.set(taskId, { ...task }); 
            console.log(`[Task ${taskId}] Job ${currentJob.id} finished with status: ${task.jobs[i].status}`);
        }

        // Close browser only if it was successfully launched
        if (page) await page.close(); 
        if (browser) {
             await browser.close();
             browser = null;
             console.log(`[Task ${taskId}] Browser closed.`);
        }
       
        // Determine final task status only if not cancelled
        if (!wasCancelled) {
            if (errorCount === 0 && completedCount === task.jobs.length) {
                task.status = 'completed';
            } else if (completedCount > 0 && completedCount + errorCount === task.jobs.length) {
                task.status = 'partially_completed';
            } else if (completedCount === 0 && errorCount === task.jobs.length) {
                task.status = 'error';
                task.error = 'All screenshot jobs failed.';
            } else {
                task.status = 'error'; 
                task.error = 'Task finished in an unexpected state.';
            }
        } // If wasCancelled, status is already set to 'cancelled'
        
        console.log(`[Process Task] Task ${taskId} finished with status: ${task.status} (Completed: ${completedCount}, Errors: ${errorCount}, Cancelled: ${wasCancelled})`);

    } catch (error: any) {
        console.error(`[Process Task] Major error during task ${taskId} execution:`, error);
        // Ensure status is set to error if a major exception occurs
        if (task && task.status !== 'cancelled') { // Avoid overwriting cancellation status
            task.status = 'error';
            task.error = `Processing failed due to unexpected error: ${error.message}`;
        }
        // Attempt to close browser if it exists
        if (browser) {
            try { await browser.close(); browser = null; } catch (e: any) { console.error(`[Task ${taskId}] Failed to close browser after error:`, e); }
        }
    } finally {
        // Ensure browser is definitely closed
        if (browser) {
            try { await browser.close(); } catch (e: any) { console.error(`[Task ${taskId}] Failed to close browser in finally block:`, e); }
        }
        // Update the final task status in the store
        // Make sure we have the most recent task object before updating
        const finalTaskState = taskStore.get(taskId);
        if (finalTaskState) {
            // Only update if the status determined here is different, or if it was cancelled
            if (finalTaskState.status !== task.status || wasCancelled) {
                 finalTaskState.status = task.status; // Use status determined in the try/catch block
                 if(task.error) finalTaskState.error = task.error;
                 taskStore.set(taskId, { ...finalTaskState });
                 console.log(`[Process Task] Final status (${task.status}) saved for task ${taskId}.`);
            }
        } else {
            console.error(`[Process Task] Task ${taskId} not found in store during final update.`);
        }
    }
} 