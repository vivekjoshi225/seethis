import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs-extra';
import { URL } from 'url';
import taskStore from '@/lib/task-store';
import { ScreenshotTask, ScreenshotJob } from '@/types/screenshot';

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

async function processSingleJob(job: ScreenshotJob, task: ScreenshotTask, page: Page): Promise<Partial<ScreenshotJob>> {
    const { url: rawUrl, width, height, fullPage, id: jobId } = job;
    const { taskId, taskSpecificDir } = task;

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
    } catch (error: any) {
        console.error(`[Task ${taskId}] Invalid URL for job ${jobId}: ${rawUrl}`, error);
        return { status: 'error', message: `Invalid URL format: ${error.message || 'Unknown URL error'}` };
    }

    // --- Screenshot Logic ---
    const filename = `${hostname}_${width}x${height}_${jobId}.png`;
    const localFilePath = path.join(taskSpecificDir, filename);
    const publicImageUrl = `/task_screenshots/${taskId}/${filename}`; // Relative path for web access

    try {
        console.log(`[Task ${taskId}] Processing job ${jobId}: ${url} at ${width}x${height}`);
        await page.setViewport({ width, height });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); // 60 sec timeout

        // Optional wait time (could be added to task config)
        // await new Promise(resolve => setTimeout(resolve, waitMs));

        await page.screenshot({
            path: localFilePath,
            fullPage: fullPage,
            type: 'png'
        });
        console.log(`[Task ${taskId}] Screenshot saved for job ${jobId}: ${localFilePath}`);
        return { status: 'completed', imageUrl: publicImageUrl };

    } catch (error: any) {
        console.error(`[Task ${taskId}] Error processing job ${jobId} (${url}):`, error);
        let errorMessage = 'Failed to capture screenshot.';
        if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
            errorMessage = `Could not resolve hostname: ${hostname}`;
        } else if (error.message.includes('TimeoutError')) {
            errorMessage = 'Page navigation timeout';
        }
        return { status: 'error', message: `${errorMessage} (${error.message})` };
    }
}

export async function processScreenshotTask(taskId: string): Promise<void> {
    const task = taskStore.get(taskId);
    if (!task) {
        console.error(`[Process Task] Task ${taskId} not found in store.`);
        return;
    }

    // Prevent processing if already done or failed
    if (task.status !== 'pending' && task.status !== 'processing') {
        console.warn(`[Process Task] Task ${taskId} has status ${task.status}, skipping processing.`);
        return;
    }

    task.status = 'processing';
    taskStore.set(taskId, task);
    console.log(`[Process Task] Starting processing for task ${taskId}`);

    let browser: Browser | null = null;
    let completedCount = 0;
    let errorCount = 0;

    try {
        console.log(`[Task ${taskId}] Launching Puppeteer...`);
        browser = await puppeteer.launch(puppeteerLaunchOptions);
        const page: Page = await browser.newPage();
        console.log(`[Task ${taskId}] Puppeteer launched.`);

        // Process jobs one by one (can be parallelized for performance later)
        for (let i = 0; i < task.jobs.length; i++) {
            const currentJob = task.jobs[i];
            
            // Update job status to processing
            currentJob.status = 'processing';
            taskStore.set(taskId, task); // Update store with processing status

            const result = await processSingleJob(currentJob, task, page);

            // Update job with result
            task.jobs[i] = { ...currentJob, ...result };
            if (result.status === 'completed') {
                completedCount++;
            } else if (result.status === 'error') {
                errorCount++;
            }
            taskStore.set(taskId, task); // Update store with job result
            console.log(`[Task ${taskId}] Job ${currentJob.id} finished with status: ${task.jobs[i].status}`);
        }

        await browser.close();
        browser = null;
        console.log(`[Task ${taskId}] Browser closed.`);

        // Determine final task status
        if (errorCount === 0 && completedCount === task.jobs.length) {
            task.status = 'completed';
        } else if (completedCount > 0) {
            task.status = 'partially_completed';
        } else {
            task.status = 'error';
            task.error = 'All jobs failed to process.';
        }
        console.log(`[Process Task] Task ${taskId} finished with status: ${task.status} (Completed: ${completedCount}, Errors: ${errorCount})`);

    } catch (error: any) {
        console.error(`[Process Task] Major error during task ${taskId} execution:`, error);
        task.status = 'error';
        task.error = `Processing failed: ${error.message}`;
        if (browser) {
            try { await browser.close(); } catch (e: any) { console.error(`[Task ${taskId}] Failed to close browser after error:`, e); }
        }
    } finally {
        // Ensure browser is closed even if unexpected errors occur
        if (browser) {
            try { await browser.close(); } catch (e: any) { console.error(`[Task ${taskId}] Failed to close browser in finally block:`, e); }
        }
        // Update the final task status in the store
        taskStore.set(taskId, task);
    }
} 