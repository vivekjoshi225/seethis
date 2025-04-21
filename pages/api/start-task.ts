import type { NextApiRequest, NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs-extra';
import taskStore from '@/lib/task-store';
import { processScreenshotTask } from '@/lib/process-task'; // We will create this next
import {
  ScreenshotTask,
  ScreenshotJob,
  StartTaskPayload,
  TaskStatus,
} from '@/types/screenshot';

// Base directory for storing task-specific screenshots (within /public)
const BASE_TASK_SCREENSHOT_DIR = path.join(process.cwd(), 'public', 'task_screenshots');
fs.ensureDirSync(BASE_TASK_SCREENSHOT_DIR);

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { urls, width, height, fullPage }: StartTaskPayload = req.body;

  // Basic validation
  if (!urls || !Array.isArray(urls) || urls.length === 0 || !width || !height) {
    return res.status(400).json({ error: 'Invalid input: urls (array), width, and height are required.' });
  }
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
    return res.status(400).json({ error: 'Invalid dimensions.' });
  }
  if (typeof fullPage !== 'boolean') {
    return res.status(400).json({ error: 'Invalid fullPage value.' });
  }

  const taskId = uuidv4();
  const taskSpecificDir = path.join(BASE_TASK_SCREENSHOT_DIR, taskId);
  fs.ensureDirSync(taskSpecificDir); // Create directory for this task's screenshots

  // Create initial job list
  const jobs: ScreenshotJob[] = urls.map((url, index) => ({
    id: `${taskId}-${index}`,
    url: url.trim(), // Trim whitespace
    width,
    height,
    fullPage,
    status: 'pending',
  }));

  // Create and store the task details
  const newTask: ScreenshotTask = {
    taskId,
    status: 'pending', // Initial status
    jobs,
    createdAt: Date.now(),
    taskSpecificDir, // Store the full path
  };
  taskStore.set(taskId, newTask);
  console.log(`[API /start-task] Task ${taskId} created. Jobs: ${jobs.length}`);

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