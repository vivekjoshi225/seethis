import type { NextApiRequest, NextApiResponse } from 'next';
import { getTask } from '@/lib/task-store'; // NEW
import { TaskStatusResponse } from '@/types/screenshot';

// Make handler async
export default async function handler(
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

  // --- Simplified DEBUG LOGGING ---
  console.log(`[API /task-status] Checking status for taskId: ${taskId}`);
  // Removed store size/keys logging as it's not directly applicable/efficient with KV store
  // --- END DEBUG LOGGING ---

  let task;
  try {
    task = await getTask(taskId); // NEW
  } catch (error: any) {
    console.error(`[API /download-zip] Error fetching task ${taskId} from store:`, error);
    return res.status(500).json({ error: `Failed to retrieve task details. Store error: ${error.message}` });
  }

  if (!task) {
    // console.error(`[API /task-status] Task ${taskId} not found in store!`); // Keep console error if desired
    return res.status(404).json({ error: `Task with ID ${taskId} not found.` });
  }

  // Return the current state of the task, conforming to the updated TaskStatusResponse
  const response: TaskStatusResponse = {
    taskId: task.taskId,
    status: task.status,
    jobs: task.jobs,
    error: task.error || null, // Ensure error is null if undefined
  };

  res.status(200).json(response);
} 