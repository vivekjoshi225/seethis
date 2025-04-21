const express = require('express');
const http = require('http'); // Required for WebSocket server
const WebSocket = require('ws');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs-extra'); // Use fs-extra for ensureDirSync and emptyDirSync
const archiver = require('archiver');
const { URL } = require('url'); // Use the built-in URL class
const { v4: uuidv4 } = require('uuid'); // For generating unique task IDs

const app = express();
const server = http.createServer(app); // Create HTTP server for Express
const wss = new WebSocket.Server({ server }); // Attach WebSocket server

// Use a different port to avoid conflict with the main Next.js app (which likely uses 3000)
const PORT = process.env.PORT || 3001;
const BASE_SCREENSHOT_DIR = path.join(__dirname, 'public', 'task_screenshots');
const ZIP_DIR = path.join(__dirname, 'public', 'zips');

// Middleware for parsing form data
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // To parse potential JSON requests if needed

// Ensure base directories exist
fs.ensureDirSync(BASE_SCREENSHOT_DIR);
fs.ensureDirSync(ZIP_DIR);

// Store task details and associated WebSocket clients
const tasks = new Map(); // taskId -> { details: {}, ws: WebSocket | null, status: 'pending' | 'processing' | 'complete' | 'error', screenshotPaths: [], zipPath: null }
const clients = new Map(); // ws -> taskId

// --- WebSocket Server Logic --- 

wss.on('connection', (ws) => {
    console.log('Client connected via WebSocket');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received WS message:', data);

            if (data.type === 'register' && data.taskId) {
                if (tasks.has(data.taskId)) {
                    // Associate WebSocket connection with the task
                    clients.set(ws, data.taskId);
                    const task = tasks.get(data.taskId);
                    task.ws = ws;
                    console.log(`WebSocket client registered for Task ID: ${data.taskId}`);
                    // If task is already processing or done, maybe send current status?
                } else {
                    console.warn(`Task ID ${data.taskId} not found for registration.`);
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid Task ID for registration' }));
                }
            }
        } catch (error) {
            console.error('Failed to process WebSocket message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        const taskId = clients.get(ws);
        if (taskId && tasks.has(taskId)) {
            const task = tasks.get(taskId);
            task.ws = null; // Disassociate WebSocket
            console.log(`WebSocket client unregistered for Task ID: ${taskId}`);
            // Note: Task processing continues even if client disconnects
        }
        clients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        const taskId = clients.get(ws);
        if (taskId && tasks.has(taskId)) {
            tasks.get(taskId).ws = null;
        }
        clients.delete(ws);
    });
});

// Function to send message to the client associated with a task
function sendMessage(taskId, message) {
    const task = tasks.get(taskId);
    if (task && task.ws && task.ws.readyState === WebSocket.OPEN) {
        task.ws.send(JSON.stringify(message));
    } else {
        // console.log(`Client for task ${taskId} not connected, skipping message:`, message.type);
    }
}

// --- Express Routes --- 

// Serve the HTML form
app.get('/admin/manage/screenshot-tool', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle the form submission - Start the task
app.post('/admin/manage/screenshot-tool', async (req, res) => {
    const { urls: urlsInput, resolutions: resolutionsInput, waitTime, mode } = req.body;

    if (!urlsInput || !resolutionsInput || !waitTime || !mode) {
        return res.status(400).json({ error: 'Missing required form fields.' });
    }

    // Basic validation (can be more robust)
    const urls = Array.isArray(urlsInput) ? urlsInput : urlsInput.split(/\r?\n/).map(u => u.trim()).filter(u => u);
    const resolutions = Array.isArray(resolutionsInput) ? resolutionsInput : resolutionsInput.split(/\r?\n/).map(r => r.trim()).filter(r => r);
    const waitMs = parseInt(waitTime, 10);

    if (urls.length === 0 || resolutions.length === 0 || isNaN(waitMs) || waitMs < 0) {
        return res.status(400).json({ error: 'Invalid input: Please provide valid URLs, resolutions, and wait time.' });
    }

    const taskId = uuidv4();
    const taskDetails = { urls, resolutions, waitMs, mode };
    const taskScreenshotDir = path.join(BASE_SCREENSHOT_DIR, taskId);

    // Store task info
    tasks.set(taskId, {
        details: taskDetails,
        ws: null,
        status: 'pending',
        screenshotPaths: [],
        zipPath: null,
        screenshotDir: taskScreenshotDir
    });

    console.log(`Task ${taskId} created.`);

    // Send response immediately
    res.json({ status: 'accepted', taskId: taskId });

    // Start processing asynchronously
    processScreenshots(taskId);
});

// Download route for the zip file
app.get('/download-zip', async (req, res) => {
    const taskId = req.query.taskId;
    if (!taskId || !tasks.has(taskId)) {
        return res.status(404).send('Task not found or invalid Task ID.');
    }

    const task = tasks.get(taskId);

    if (task.status !== 'complete' || !task.zipPath) {
        return res.status(404).send('Task not complete or zip file not available.');
    }

    const zipPath = task.zipPath;
    const zipFilename = `screenshots_${taskId}.zip`;

    res.download(zipPath, zipFilename, async (err) => {
        if (err) {
            console.error(`Error sending zip file for task ${taskId}:`, err);
        } else {
            console.log(`Zip file sent successfully for task ${taskId}.`);
        }
        // Clean up task data, zip file, and screenshot directory after download attempt
        console.log(`Cleaning up resources for task ${taskId}...`);
        await fs.remove(zipPath).catch(e => console.error(`Error removing zip ${zipPath}:`, e));
        await fs.remove(task.screenshotDir).catch(e => console.error(`Error removing dir ${task.screenshotDir}:`, e));
        tasks.delete(taskId);
        console.log(`Cleanup complete for task ${taskId}.`);
    });
});

// --- Screenshot Processing Logic --- 

async function processScreenshots(taskId) {
    const task = tasks.get(taskId);
    if (!task) {
        console.error(`Task ${taskId} not found for processing.`);
        return;
    }

    task.status = 'processing';
    const { urls, resolutions, waitMs, mode } = task.details;
    const taskScreenshotDir = task.screenshotDir;
    await fs.ensureDir(taskScreenshotDir); // Ensure task-specific dir exists

    sendMessage(taskId, { type: 'status', message: 'Launching browser...' });

    let browser;
    try {
        console.log(`[Task ${taskId}] Launching Puppeteer...`);
        const launchOptions = {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu']
        };
        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        console.log(`[Task ${taskId}] Puppeteer launched.`);
        sendMessage(taskId, { type: 'status', message: 'Browser launched. Starting screenshots...' });

        for (const rawUrl of urls) {
            let url = rawUrl;
            if (!url.match(/^https?:\/\//)) {
                url = `https://${url}`;
            }

            let hostname = 'invalid-url';
            let isValidUrl = true;
            try {
                const parsedUrl = new URL(url);
                hostname = parsedUrl.hostname.replace(/^www\./, '');
            } catch (err) {
                console.error(`[Task ${taskId}] Invalid URL skipped: ${rawUrl} -> ${url}`);
                isValidUrl = false;
                 // Send error progress for all resolutions of this invalid URL
                 resolutions.forEach(res => {
                    sendMessage(taskId, { type: 'progress', url: rawUrl, resolution: res, status: 'error', error: 'Invalid URL format' });
                 });
            }

            if (!isValidUrl) continue;

            for (const resolution of resolutions) {
                const match = resolution.match(/^(\d+)[xX](\d+)$/);
                if (!match) {
                    console.warn(`[Task ${taskId}] Invalid resolution format skipped: ${resolution} for URL ${url}`);
                    sendMessage(taskId, { type: 'progress', url: rawUrl, resolution: resolution, status: 'error', error: 'Invalid resolution format' });
                    continue;
                }
                const width = parseInt(match[1], 10);
                const height = parseInt(match[2], 10);

                if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
                    console.warn(`[Task ${taskId}] Invalid resolution values skipped: ${resolution} for URL ${url}`);
                     sendMessage(taskId, { type: 'progress', url: rawUrl, resolution: resolution, status: 'error', error: 'Invalid resolution dimensions' });
                    continue;
                }

                sendMessage(taskId, { type: 'status', message: `Processing ${hostname} at ${resolution}...` });
                console.log(`[Task ${taskId}] Processing ${url} at ${width}x${height}...`);

                let success = true;
                let errorMsg = null;

                try {
                    await page.setViewport({ width, height });
                    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

                    if (waitMs > 0) {
                        await new Promise(resolve => setTimeout(resolve, waitMs));
                    }

                    const takeScreenshot = async (type, fullPage) => {
                        const filename = `${hostname}_${width}x${height}_${type}.png`;
                        const filepath = path.join(taskScreenshotDir, filename);
                        await page.screenshot({
                            path: filepath,
                            fullPage: fullPage,
                            type: 'png'
                        });
                        console.log(`[Task ${taskId}] Screenshot saved: ${filename}`);
                        task.screenshotPaths.push(filepath); // Store path for zipping
                    };

                    if (mode === 'viewport' || mode === 'both') {
                        await takeScreenshot('viewport', false);
                    }
                    if (mode === 'full' || mode === 'both') {
                        await takeScreenshot('full', true);
                    }

                } catch (err) {
                    success = false;
                    errorMsg = err.message;
                    console.error(`[Task ${taskId}] Error processing ${url} at ${width}x${height}: ${errorMsg}`);
                }

                // Send progress update for this specific cell
                sendMessage(taskId, {
                    type: 'progress',
                    url: rawUrl,
                    resolution: resolution,
                    status: success ? 'success' : 'error',
                    error: errorMsg
                });
            }
        }

        console.log(`[Task ${taskId}] Finished processing all URLs and resolutions.`);
        sendMessage(taskId, { type: 'status', message: 'Finished processing. Zipping files...' });

    } catch (error) {
        console.error(`[Task ${taskId}] Error during Puppeteer operation:`, error);
        task.status = 'error';
        sendMessage(taskId, { type: 'error', message: `Server error during processing: ${error.message}` });
        // Don't try to zip if browser failed catastrophically
        if (browser) { try { await browser.close(); } catch (e) { console.error('Error closing browser after failure:', e); } }
        return; // Stop processing this task
    } finally {
        if (browser) {
             try {
                 if (browser.process() != null) await browser.close();
                 console.log(`[Task ${taskId}] Puppeteer browser closed.`);
             } catch (closeErr) {
                 console.error(`[Task ${taskId}] Error closing browser in finally block:`, closeErr);
             }
        }
    }

    // --- Zipping Logic --- 
    if (task.screenshotPaths.length > 0) {
        const zipPath = path.join(ZIP_DIR, `screenshots_${taskId}.zip`);
        task.zipPath = zipPath;
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        let zipError = null;

        output.on('close', () => {
            if (!zipError) {
                console.log(`[Task ${taskId}] Archive created: ${archive.pointer()} total bytes`);
                task.status = 'complete';
                sendMessage(taskId, {
                    type: 'complete',
                    taskId: taskId,
                    downloadUrl: `/download-zip?taskId=${taskId}`
                });
            } else {
                 console.error(`[Task ${taskId}] Zip stream closed, but error occurred earlier.`);
                 task.status = 'error';
                 sendMessage(taskId, { type: 'error', message: `Failed to create zip file: ${zipError.message}` });
                 fs.remove(zipPath).catch(e => console.error(`Error removing zip ${zipPath} after error:`, e)); // Clean up failed zip
            }
        });

        output.on('error', (err) => {
             zipError = err;
             console.error(`[Task ${taskId}] Error writing zip file stream:`, err);
             archive.abort();
             task.status = 'error';
             sendMessage(taskId, { type: 'error', message: `Error writing zip file: ${err.message}` });
             fs.remove(zipPath).catch(e => console.error(`Error removing zip ${zipPath} after stream error:`, e));
        });

        archive.on('warning', (err) => {
            console.warn(`[Task ${taskId}] Archiver warning:`, err);
        });

        archive.on('error', (err) => {
            zipError = err;
            console.error(`[Task ${taskId}] Error creating zip archive:`, err);
            task.status = 'error';
            sendMessage(taskId, { type: 'error', message: `Error creating zip archive: ${err.message}` });
            output.end(); // Ensure output stream is closed
            fs.remove(zipPath).catch(e => console.error(`Error removing zip ${zipPath} after archive error:`, e));
        });

        archive.pipe(output);
        archive.directory(taskScreenshotDir, false); // Add contents of task-specific dir
        
        try {
             await archive.finalize();
        } catch(finalizeErr) {
             if (!zipError) { // Avoid overwriting earlier stream/archive errors
                  zipError = finalizeErr;
                  console.error(`[Task ${taskId}] Error finalizing archive:`, finalizeErr);
                  task.status = 'error';
                  sendMessage(taskId, { type: 'error', message: `Error finalizing zip archive: ${finalizeErr.message}` });
                  fs.remove(zipPath).catch(e => console.error(`Error removing zip ${zipPath} after finalize error:`, e));
             }
        }

    } else {
        console.log(`[Task ${taskId}] No screenshots were generated.`);
        task.status = 'error';
        sendMessage(taskId, { type: 'error', message: 'No screenshots could be generated based on the provided inputs or due to errors.' });
        await fs.remove(taskScreenshotDir).catch(e => console.error(`Error removing dir ${taskScreenshotDir} when no screenshots generated:`, e));
        tasks.delete(taskId); // Clean up task if nothing was produced
    }
}

// --- Basic Error Handling --- 
app.use((err, req, res, next) => {
    console.error('Unhandled Express Error:', err.stack);
    if (res.headersSent) {
        return next(err);
    }
    res.status(500).json({ error: 'Something broke on the server!' });
});

// --- Start Server --- 
server.listen(PORT, () => {
    console.log(`Screenshot server (with WebSocket) running on http://localhost:${PORT}`);
    console.log(`Access the tool at http://localhost:${PORT}/admin/manage/screenshot-tool`);
});

// Graceful shutdown cleanup (optional but good practice)
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await wss.close();
  server.close(async () => {
    console.log('HTTP server closed');
    // Clean up any remaining temp files/folders
     console.log('Cleaning up temporary directories...');
     await fs.remove(BASE_SCREENSHOT_DIR).catch(e => console.error('Error removing base screenshot dir:', e));
     await fs.remove(ZIP_DIR).catch(e => console.error('Error removing zip dir:', e));
     console.log('Cleanup complete.');
     process.exit(0);
  });
}); 