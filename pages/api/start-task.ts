import type { NextApiRequest, NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import taskStore from '@/lib/task-store';
import { processScreenshotTask } from '@/lib/process-task'; // This will need to handle dir creation
import {
  ScreenshotJob,
  TaskStatus,
  startTaskSchema, // Import the Zod schema
  StartTaskPayload, // Still useful for type hints if needed, though schema handles validation
  ScreenshotTask, // Make sure ScreenshotTask is imported
} from '@/types/screenshot';

// Define the base directory path constant here so it can be used
const BASE_TASK_SCREENSHOT_DIR = path.join(process.cwd(), 'public', 'task_screenshots');
// No fs.ensureDirSync here

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // --- Validate request body using Zod (includes waitMs validation now) --- 
  const validationResult = startTaskSchema.safeParse(req.body);
  if (!validationResult.success) {
    // Combine Zod errors into a single message
    const errorMessage = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    console.warn(`[API /start-task] Validation failed: ${errorMessage}`);
    return res.status(400).json({ error: `Invalid input: ${errorMessage}` });
  }

  // --- Extract validated data (including waitMs) --- 
  const { urls, dimensions, screenshotType, waitMs } = validationResult.data;
  
  // --- Deduplicate URLs and Dimensions on backend as safeguard ---
  const uniqueUrls = Array.from(new Set(urls));
  const uniqueDimensions = Array.from(new Set(dimensions));

  const taskId = uuidv4();
  // Calculate the directory path, but don't create it here
  const taskSpecificDir = path.join(BASE_TASK_SCREENSHOT_DIR, taskId);
  // No fs.ensureDirSync(taskSpecificDir);

  // --- Create initial job list (using unique URLs/Dimensions) ---
  const jobs: ScreenshotJob[] = [];
  uniqueUrls.forEach((url) => { // Use uniqueUrls
    uniqueDimensions.forEach((dimension) => { // Use uniqueDimensions
      const baseJobId = `${taskId}-${url}-${dimension}`.replace(/[^a-zA-Z0-9-_]/g, '_');

      if (screenshotType === 'viewport' || screenshotType === 'both') {
        jobs.push({
          id: `${baseJobId}-vp`,
          url: url.trim(), // URL should already be trimmed/validated by schema
          dimension: dimension,
          screenshotType: 'viewport',
          status: 'pending',
          waitMs: waitMs,
        });
      }
      if (screenshotType === 'fullPage' || screenshotType === 'both') {
        jobs.push({
          id: `${baseJobId}-fp`,
          url: url.trim(), 
          dimension: dimension,
          screenshotType: 'fullPage',
          status: 'pending',
          waitMs: waitMs,
        });
      }
    });
  });

  if (jobs.length === 0) {
      return res.status(400).json({ error: 'No valid screenshot jobs could be generated after deduplication.' });
  }

  // Create the task object including the calculated path
  const newTask: ScreenshotTask = { // Ensure it conforms to ScreenshotTask type
    taskId,
    status: 'pending' as TaskStatus,
    jobs,
    createdAt: Date.now(),
    taskSpecificDir, // Include the path for the background task
  };
  taskStore.set(taskId, newTask); // This should now satisfy the type checker
  console.log(`[API /start-task] Task ${taskId} created. Jobs: ${jobs.length} (Type: ${screenshotType}, Wait: ${waitMs}ms), Path: ${taskSpecificDir}`);

  // Start processing asynchronously (don't await)
  processScreenshotTask(taskId).catch((error: Error) => {
    console.error(`[API /start-task] Background processing failed for task ${taskId}:`, error);
    // Update task status to error if background processing fails immediately
    const task = taskStore.get(taskId);
    if (task) {
      task.status = 'error';
      task.error = 'Background processing failed to start.';
      taskStore.set(taskId, task);
    }
  });

  // Respond immediately with the Task ID
  res.status(202).json({ taskId });
} 