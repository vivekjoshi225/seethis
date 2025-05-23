import type { NextApiRequest, NextApiResponse } from 'next';
import { getTask, setTask } from '@/lib/task-store';
import { TaskStatus } from '@/types/screenshot';

type CancelResponse = { message: string } | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CancelResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { taskId } = req.body;

  if (!taskId || typeof taskId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid taskId in request body.' });
  }

  console.log(`[API /cancel-task] Received cancellation request for task: ${taskId}`);

  const task = await getTask(taskId);

  if (!task) {
    console.warn(`[API /cancel-task] Task ${taskId} not found for cancellation.`);
    // Return success even if not found, as the goal is for it to be stopped.
    return res.status(200).json({ message: `Task ${taskId} not found or already finished.` });
  }

  // Check if the task is in a state that can be cancelled
  const cancellableStatuses: TaskStatus[] = ['pending', 'processing'];
  if (cancellableStatuses.includes(task.status)) {
    console.log(`[API /cancel-task] Setting task ${taskId} status to 'cancelling'.`);
    // Set status to 'cancelling'. The background process will pick this up.
    task.status = 'cancelling';
    task.error = 'Task cancelled by user request.'; // Add cancellation reason
    try {
        await setTask(taskId, task);
        return res.status(200).json({ message: `Task ${taskId} cancellation initiated.` });
    } catch(storeError) {
        console.error(`[API /cancel-task] Failed to update task ${taskId} status to cancelling in store.`, storeError);
        return res.status(500).json({ error: `Failed to initiate cancellation for task ${taskId}. Please try again.` });
    }
  } else {
    console.log(`[API /cancel-task] Task ${taskId} is already in status '${task.status}', cannot cancel.`);
    // If it's already completed, failed, or cancelled, just confirm it's stopped.
    return res.status(200).json({ message: `Task ${taskId} is already in a final state (${task.status}).` });
  }
} 