import type { NextApiRequest, NextApiResponse } from 'next';
import taskStore from '@/lib/task-store';
import { TaskStatusResponse } from '@/types/screenshot';

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<TaskStatusResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { taskId } = req.query;

  if (!taskId || typeof taskId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid taskId query parameter.' });
  }

  // --- DEBUG LOGGING ---
  console.log(`[API /task-status] Checking for taskId: ${taskId}. Current store size: ${taskStore.size}`);
  console.log(`[API /task-status] Store keys: ${JSON.stringify(Array.from(taskStore.keys()))}`);
  // --- END DEBUG LOGGING ---

  const task = taskStore.get(taskId);

  if (!task) {
    console.error(`[API /task-status] Task ${taskId} not found in store!`);
    return res.status(404).json({ error: `Task with ID ${taskId} not found.` });
  }

  // Determine if zip is ready (simple check for now)
  const zipReady = task.status === 'completed' || task.status === 'partially_completed';

  // Return the current state of the task
  const response: TaskStatusResponse = {
    taskId: task.taskId,
    status: task.status,
    jobs: task.jobs, // Send the status of all jobs
    error: task.error,
    zipReady: zipReady
  };

  res.status(200).json(response);
} 