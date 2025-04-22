import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs-extra';
import { URL } from 'url';
import { getTask, setTask } from '@/lib/task-store';
import { ScreenshotTask, ScreenshotJob, TaskStatus } from '@/types/screenshot';

// Vercel Deployment Notes:
// 1. Puppeteer: Standard 'puppeteer' might exceed size/memory limits.
//    Consider using '@sparticuz/chromium' and 'puppeteer-core'.
//    See: https://github.com/Sparticuz/chromium
// 2. Task Store: In-memory 'taskStore' is NOT suitable for serverless.
//    Each API call/function invocation is stateless. Use Vercel KV, Upstash Redis,
//    or a database for persistent task state tracking.
// 3. File Storage: Serverless functions have limited, ephemeral writable storage
//    at /tmp. Writing to other locations (like 'public') is unreliable.
//    Screenshots saved to /tmp will NOT persist across invocations or scaling.
//    For persistent storage, upload screenshots to Vercel Blob, S3, etc.

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

// Use the same path as defined in start-task.ts
// Use process.cwd() instead of hardcoded '/tmp' for cross-platform compatibility
const BASE_SCREENSHOTS_DIR = path.join(process.cwd(), 'public', 'task_screenshots');

// --- Helper Functions (parseDimension, sanitizeForFilename, generateScreenshotFilename) ---
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

function sanitizeForFilename(text: string): string {
    // Remove protocol, replace common invalid chars with underscore
    // Keep dots for domain, replace slashes in path
    return text
        .replace(/^https?:\/\//, '')
        .replace(/\//g, '_') // Replace slashes with underscore
        .replace(/[^a-zA-Z0-9_.-]/g, '') // Remove other invalid chars
        .substring(0, 100); // Limit length to prevent excessively long names
}

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
// --- End Helper Functions ---


async function processSingleJob(job: ScreenshotJob, task: ScreenshotTask, page: Page): Promise<Partial<ScreenshotJob>> {
    // Extract data, including waitMs
    const { url: rawUrl, dimension, screenshotType, id: jobId, waitMs: initialWaitMs } = job;
    const { taskId, taskSpecificDir } = task; // Use taskSpecificDir from the task object directly

    // --- Ensure Directory Exists (Crucial Step!) ---
    try {
        await fs.ensureDir(taskSpecificDir); // Create directory if it doesn't exist
        console.log(`[Task ${taskId}] Ensuring directory exists: ${taskSpecificDir}`);
    } catch (dirError: any) {
         console.error(`[Task ${taskId}] Failed to create screenshot directory ${taskSpecificDir}:`, dirError);
         // Return only properties defined in ScreenshotJob
         return { status: 'error', message: `Failed to create storage directory: ${dirError.message}` };
    }
    // --- End Directory Creation ---

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
    // For public URL, use the path relative to public directory
    const publicImageUrl = `/task_screenshots/${taskId}/${filename}`;

    try {
        // Cap the wait time at 5000ms as a final safeguard
        const waitMs = Math.min(initialWaitMs || 0, 5000);

        console.log(`[Task ${taskId}] Processing job ${jobId}: ${url} (${dimension}, ${screenshotType}, wait: ${waitMs}ms)`);

        await page.setViewport({ width, height });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT });

        // --- Add Delay if specified (using the capped value) ---
        if (waitMs > 0) {
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
        // Return both the local path and a public URL for the image
        return { 
            status: 'completed', 
            localPath: localFilePath,
            imageUrl: publicImageUrl // Add the public URL for frontend access
        };

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
            // Append the original error message for more context
            errorMessage = `${errorMessage} (${error.message})`;
        } else {
             errorMessage = `An unknown error occurred: ${String(error)}`;
        }
        // Return only properties defined in ScreenshotJob
        return { status: 'error', message: errorMessage };
    }
}


export async function processScreenshotTask(taskId: string): Promise<void> {
    // Initial task fetch
    let task = await getTask(taskId);
    if (!task) {
        console.error(`[Process Task] Task ${taskId} not found in store. Cannot process.`);
        return; // Task doesn't exist, nothing to process
    }

    // Initial status check (no change needed here)
    if (task.status !== 'pending' && task.status !== 'processing') {
        console.warn(`[Process Task] Task ${taskId} already has status ${task.status}, skipping processing.`);
        return;
    }

    // --- Set to processing ---
    console.log(`[Process Task] Setting task ${taskId} to processing...`);
    task.status = 'processing';
    task.error = undefined; // Clear any previous errors when starting processing
    try {
        await setTask(taskId, task); // NEW - Update KV store immediately
        console.log(`[Process Task] Task ${taskId} status set to processing in store. Starting ${task.jobs.length} jobs.`);
    } catch (storeError) {
         console.error(`[Process Task] Failed to set task ${taskId} status to processing in store. Aborting.`, storeError);
         // Optionally, try to set status to error here, but might also fail
         return;
    }
    // --- End Set to processing ---


    let browser: Browser | null = null;
    let completedCount = 0; // Tracks jobs completed in *this run*
    let errorCount = 0; // Tracks jobs failed in *this run*
    let wasCancelled = false; // Flag to track cancellation detection during *this run*

    try {
        console.log(`[Task ${taskId}] Launching Puppeteer...`);
        browser = await puppeteer.launch(puppeteerLaunchOptions);
        const page: Page = await browser.newPage();
        console.log(`[Task ${taskId}] Puppeteer launched successfully.`);

        // Iterate through jobs defined in the initial task object
        for (let i = 0; i < task.jobs.length; i++) {
             // --- Check for cancellation before processing each job ---
            const latestTaskState = await getTask(taskId); // NEW - Get latest state from KV
            if (!latestTaskState) {
                 console.error(`[Task ${taskId}] Task disappeared from store mid-processing (before job ${i}).`);
                 wasCancelled = true; // Treat as cancelled/error
                 // Cannot update task status if it's gone
                 break;
            }

            // Update local task object with the very latest state from the store
            // This ensures we act on the most recent status (e.g., cancellation)
            task = latestTaskState;

            if (task.status === 'cancelling' || task.status === 'cancelled') {
                console.log(`[Task ${taskId}] Cancellation detected before processing job ${i}. Stopping job processing.`);
                wasCancelled = true;
                // Final status will be set in the finally block
                break; // Exit the job processing loop
            }
            // --- End cancellation check ---

            // Get the specific job from the potentially updated task object
            // Use the index 'i' from the original loop, assuming job order doesn't change
            // If job IDs could change or jobs be removed, a findIndex approach would be safer
            const currentJob = task.jobs[i];
            if (!currentJob) {
                console.error(`[Task ${taskId}] Job at index ${i} not found in latest task state. Skipping.`);
                errorCount++; // Count as an error for this run
                continue;
            }


            // Skip if job already processed (e.g., completed/error in a previous run)
            // Only process jobs that are 'pending'
             if (currentJob.status !== 'pending') {
                console.warn(`[Task ${taskId}] Job ${currentJob.id} already has status ${currentJob.status}. Skipping.`);
                // Do not increment counts here, they are for jobs processed *in this run*
                continue;
            }

            // --- Update job status to processing ---
            console.log(`[Task ${taskId}] Setting job ${currentJob.id} status to processing...`);
            task.jobs[i].status = 'processing';
            try {
                await setTask(taskId, task); // NEW - Update KV store to reflect job started processing
            } catch (storeError) {
                console.error(`[Task ${taskId}] Failed to update job ${currentJob.id} status to processing in store. Continuing processing attempt, but state may be inconsistent.`, storeError);
                // Proceed with the job, but log the state inconsistency risk
            }
            // --- End Update job status ---


            // --- Process the job ---
            // Pass the current task object state to processSingleJob
            const result = await processSingleJob(currentJob, task, page);
            console.log(`[Task ${taskId}] Job ${currentJob.id} processing attempt finished with status: ${result.status || 'unknown'}`);
            // --- End Process the job ---


            // ----- CRITICAL: Re-fetch task state BEFORE applying job result -----
            // This prevents overwriting changes made by other processes (e.g., cancellation)
            // between starting the job and finishing it.
            const taskStateBeforeUpdate = await getTask(taskId);
            if (!taskStateBeforeUpdate) {
                console.error(`[Task ${taskId}] Task disappeared before updating result for job ${currentJob.id}.`);
                wasCancelled = true; // Treat as error/cancelled
                // Cannot update task status if it's gone
                break; // Stop processing
            }
            // Use the latest state from KV store as the base for update
            task = taskStateBeforeUpdate;
            // Find the index again in the potentially updated jobs array
            const jobIndex = task.jobs.findIndex(j => j.id === currentJob.id);
            if (jobIndex === -1) {
                 console.error(`[Task ${taskId}] Job ${currentJob.id} not found in latest task state when trying to update result. Skipping update for this job.`);
                 errorCount++; // Count as an error for this run
                 continue; // Move to the next job index
            }
            // --------------------------------------------------------------------

            // Update job result in the LATEST task object
            // Ensure status is explicitly set, defaulting to 'error' if result is incomplete
            task.jobs[jobIndex] = { ...task.jobs[jobIndex], ...result, status: result.status || 'error' };

            // Update counts for *this run* based on the result we just got
            if (result.status === 'completed') {
                completedCount++;
            } else { // Treat any non-complete status from processSingleJob as an error for counting purposes
                errorCount++;
            }

            // Update KV store with the latest task state including the job result
             try {
                await setTask(taskId, task);
                console.log(`[Task ${taskId}] Updated store with result for job ${task.jobs[jobIndex].id} (Status: ${task.jobs[jobIndex].status})`);
            } catch (storeError) {
                 console.error(`[Task ${taskId}] Failed to update store with result for job ${task.jobs[jobIndex].id}. State may be inconsistent.`, storeError);
                 // Continue processing other jobs if possible
            }


             // Re-check cancellation status immediately after job completion and update
             // Use the task object we just updated and potentially saved
             if (task.status === 'cancelling') {
                 console.log(`[Task ${taskId}] Cancellation detected immediately after job ${currentJob.id} update.`);
                 wasCancelled = true;
                 // Final status set in finally block
                 break; // Exit loop
             }
        } // End of job loop

    } catch (error: any) {
        // This catches major errors in the overall processing loop (e.g., Puppeteer launch failure)
        console.error(`[Process Task] Catastrophic error during task ${taskId} execution:`, error);
        errorCount = task ? task.jobs.length - completedCount : 0; // Mark remaining jobs as errors if task object exists

        // Attempt to fetch latest state before updating error status
        try {
             const taskOnError = await getTask(taskId);
             if (taskOnError && taskOnError.status !== 'cancelled' && taskOnError.status !== 'cancelling') { // Avoid overwriting cancellation status
                 taskOnError.status = 'error';
                 taskOnError.error = `Processing failed: ${error.message || 'Unknown catastrophic error'}`;
                 await setTask(taskId, taskOnError); // Update KV store with error
                 task = taskOnError; // Update local task for finally block logging
                 console.log(`[Task ${taskId}] Set task status to error in store due to catastrophic failure.`);
             } else if (task && task.status !== 'cancelled' && task.status !== 'cancelling') {
                 // Fallback if fetch fails, update local task object status for logging
                 task.status = 'error';
                 task.error = `Processing failed: ${error.message}. Failed to fetch latest state during error handling.`;
                 console.warn(`[Task ${taskId}] Could not fetch latest state during error handling. Status may be inconsistent.`);
             }
        } catch (getError) {
             console.error(`[Task ${taskId}] Failed even to fetch task state during catastrophic error handling.`, getError);
             // Update local task status if possible for logging
             if (task) {
                 task.status = 'error';
                 task.error = `Processing failed: ${error.message}. Also failed to fetch state during error handling.`;
             }
        }

    } finally {
        // Ensure browser is definitely closed
        if (browser) {
            console.log(`[Task ${taskId}] Closing browser in finally block...`);
            try {
                await browser.close();
                console.log(`[Task ${taskId}] Browser closed successfully.`);
            } catch (e: any) {
                 console.error(`[Task ${taskId}] Failed to close browser in finally block:`, e);
            }
        } else {
             console.log(`[Task ${taskId}] No active browser instance to close in finally block.`);
        }


        // --- Final Task Status Update ---
        console.log(`[Task ${taskId}] Entering final status update logic...`);
        try {
             // Fetch the absolute latest state one last time
            const finalTaskState = await getTask(taskId);

            if (finalTaskState) {
                // Use the state fetched just now as the base for final decision
                task = finalTaskState;
                 let finalStatus: TaskStatus = task.status; // Start with current status
                 let finalError: string | undefined = task.error;

                // Recalculate final counts based on the *absolute latest* state from the store
                const finalCompletedCount = task.jobs.filter(j => j.status === 'completed').length;
                const finalErrorCount = task.jobs.filter(j => j.status === 'error').length;
                const finalPendingCount = task.jobs.filter(j => j.status === 'pending').length;
                const finalProcessingCount = task.jobs.filter(j => j.status === 'processing').length; // Jobs potentially stuck?
                const totalJobs = task.jobs.length;

                console.log(`[Task ${taskId}] Final check - Total: ${totalJobs}, Completed: ${finalCompletedCount}, Errors: ${finalErrorCount}, Pending: ${finalPendingCount}, Processing: ${finalProcessingCount}, Detected Cancel: ${wasCancelled}`);


                // Determine the final status based on job states *unless* cancellation occurred
                if (wasCancelled || task.status === 'cancelled') { // Simplified check for cancellation
                    finalStatus = 'cancelled';
                    finalError = finalError || 'Task cancelled.'; // Set default cancel message if none exists
                     console.log(`[Task ${taskId}] Final status determined as 'cancelled'.`);
                } else if (task.status === 'error') {
                     // If already marked as error (e.g., catastrophic failure), keep it.
                     finalStatus = 'error';
                     finalError = finalError || 'Task failed during processing.';
                     console.log(`[Task ${taskId}] Final status remains 'error' due to earlier failure.`);
                } else if (finalPendingCount === 0 && finalProcessingCount === 0) {
                    // All jobs have reached a terminal state (completed or error)
                    if (finalErrorCount === 0) {
                        finalStatus = 'completed';
                        finalError = undefined; // Clear errors on full success
                        console.log(`[Task ${taskId}] Final status determined as 'completed'.`);
                    } else if (finalCompletedCount > 0) {
                        finalStatus = 'partially_completed';
                        finalError = finalError || `${finalErrorCount} job(s) failed.`;
                        console.log(`[Task ${taskId}] Final status determined as 'partially_completed'.`);
                    } else { // All finished, but none completed (all errors)
                        finalStatus = 'error';
                        finalError = finalError || 'All screenshot jobs failed.';
                        console.log(`[Task ${taskId}] Final status determined as 'error' (all jobs failed).`);
                    }
                } else {
                     // Jobs still pending/processing - this shouldn't happen if the loop finished normally
                     // Mark as error, indicates an unexpected state or interruption
                     finalStatus = 'error';
                     finalError = finalError || `Task processing stopped unexpectedly with ${finalPendingCount + finalProcessingCount} jobs unfinished.`;
                     console.warn(`[Task ${taskId}] Final state has ${finalPendingCount} pending, ${finalProcessingCount} processing jobs. Setting status to 'error'.`);
                }

                // Only update the store if the calculated final status/error differs from what's stored
                if (task.status !== finalStatus || task.error !== finalError) {
                    task.status = finalStatus;
                    task.error = finalError;
                    console.log(`[Task ${taskId}] Saving final calculated status (${task.status}) and error ('${task.error || 'none'}') to store...`);
                    await setTask(taskId, task); // Update KV store with final calculated state
                    console.log(`[Task ${taskId}] Final status update saved to store.`);
                } else {
                    console.log(`[Task ${taskId}] Final calculated status (${finalStatus}) matches stored status. No final update needed.`);
                }

            } else {
                // Task disappeared completely
                console.error(`[Process Task] Task ${taskId} was not found in store during final update phase.`);
                // Cannot update status if task is gone
            }
        } catch (finalUpdateError) {
             console.error(`[Process Task] Error occurred during final task status update for ${taskId}:`, finalUpdateError);
             // Log error, but can't do much else if saving the final state fails
        }
        // --- End Final Task Status Update ---
    }

    // Final log message (using the status determined in finally block, if task exists)
    console.log(`[Process Task] Finished processing attempt for task ${taskId}. Determined Status: ${task?.status ?? 'unknown (task missing?)'}.`);
}