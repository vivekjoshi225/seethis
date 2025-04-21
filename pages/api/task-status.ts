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
    // console.error(`[API /task-status] Task ${taskId} not found in store!`); // Keep console error if desired
    return res.status(404).json({ error: `Task with ID ${taskId} not found.` });
  }

  // Return the current state of the task, conforming to the updated TaskStatusResponse
  const response: TaskStatusResponse = {
    taskId: task.taskId,
    status: task.status,
    jobs: task.jobs,
    error: task.error || null,
  };

  res.status(200).json(response);
} 