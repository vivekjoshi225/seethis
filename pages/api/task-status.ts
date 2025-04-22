import type { NextApiRequest, NextApiResponse } from 'next';
import { getTask } from '@/lib/task-store'; // NEW
import { TaskStatusResponse } from '@/types/screenshot';

// Define a type for error responses that includes debug info
interface ErrorResponse {
  error: string;
  debug?: {
    env: string;
    nodeVersion: string;
    timestamp: string;
    [key: string]: any;
  };
}

// Environment detection
const isVercelProduction = process.env.VERCEL === '1';

// Make handler async
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TaskStatusResponse | ErrorResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { taskId } = req.query;

  if (!taskId || typeof taskId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid taskId query parameter.' });
  }

  // --- Enhanced DEBUG LOGGING ---
  console.log(`[API /task-status] Checking status for taskId: ${taskId}`);
  console.log(`[API /task-status] Environment: ${isVercelProduction ? 'Vercel production' : 'local development'}`);
  console.log(`[API /task-status] Node version: ${process.version}`);
  // --- END DEBUG LOGGING ---

  let task;
  try {
    console.log(`[API /task-status] Fetching task ${taskId} from KV store...`);
    task = await getTask(taskId); // NEW
    console.log(`[API /task-status] Task fetch result: ${task ? 'Success' : 'Not found'}`);
  } catch (error: any) {
    console.error(`[API /task-status] Error fetching task ${taskId} from store:`, error);
    return res.status(500).json({ 
      error: `Failed to retrieve task details. Store error: ${error.message}`,
      debug: { 
        env: isVercelProduction ? 'vercel' : 'local',
        nodeVersion: process.version,
        timestamp: new Date().toISOString()
      } 
    });
  }

  if (!task) {
    console.error(`[API /task-status] Task ${taskId} not found in store!`);
    return res.status(404).json({ error: `Task with ID ${taskId} not found.` });
  }

  // Log additional details for debugging
  console.log(`[API /task-status] Task ${taskId} details:
    Status: ${task.status}
    Jobs: ${task.jobs.length}
    Jobs Pending: ${task.jobs.filter(j => j.status === 'pending').length}
    Jobs Processing: ${task.jobs.filter(j => j.status === 'processing').length}
    Jobs Completed: ${task.jobs.filter(j => j.status === 'completed').length}
    Jobs Error: ${task.jobs.filter(j => j.status === 'error').length}
    Error: ${task.error || 'none'}
  `);

  // Return the current state of the task, conforming to the updated TaskStatusResponse
  const response: TaskStatusResponse = {
    taskId: task.taskId,
    status: task.status,
    jobs: task.jobs,
    error: task.error || null, // Ensure error is null if undefined
    // Add debug info for troubleshooting
    debug: {
      env: isVercelProduction ? 'vercel' : 'local',
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
      pendingCount: task.jobs.filter(j => j.status === 'pending').length,
      processingCount: task.jobs.filter(j => j.status === 'processing').length,
      completedCount: task.jobs.filter(j => j.status === 'completed').length,
      errorCount: task.jobs.filter(j => j.status === 'error').length
    }
  };

  res.status(200).json(response);
} 