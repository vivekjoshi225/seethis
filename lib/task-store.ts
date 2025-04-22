import { kv } from '@vercel/kv';
import { ScreenshotTask } from '@/types/screenshot';

/**
 * Retrieves a task from the Vercel KV store.
 * @param taskId The ID of the task to retrieve.
 * @returns The task data or null if not found.
 */
export async function getTask(taskId: string): Promise<ScreenshotTask | null> {
  console.log(`[KV Store] Attempting to get task: ${taskId}`);
  try {
    const task = await kv.get<ScreenshotTask>(taskId);
    console.log(`[KV Store] kv.get result for ${taskId}:`, task ? '{...task data...}' : 'null');
    return task;
  } catch (error) {
    console.error(`[KV Store] Error getting task ${taskId}:`, error);
    return null; // Or re-throw depending on desired error handling
  }
}

/**
 * Saves or updates a task in the Vercel KV store.
 * @param taskId The ID of the task to save.
 * @param taskData The task data to store.
 */
export async function setTask(taskId: string, taskData: ScreenshotTask): Promise<void> {
  console.log(`[KV Store] Attempting to set task: ${taskId}`);
  try {
    // TODO: Consider adding expiration based on task status (e.g., completed tasks)
    await kv.set(taskId, taskData);
    console.log(`[KV Store] Successfully set task: ${taskId}`);
  } catch (error) {
    console.error(`[KV Store] Error setting task ${taskId}:`, error);
    // Or re-throw
    throw error; // Re-throw error so callers know it failed
  }
}

/**
 * Deletes a task from the Vercel KV store.
 * @param taskId The ID of the task to delete.
 */
export async function deleteTask(taskId: string): Promise<void> {
  console.log(`[KV Store] Attempting to delete task: ${taskId}`);
  try {
    await kv.del(taskId);
    console.log(`[KV Store] Successfully deleted task: ${taskId}`);
  } catch (error) {
    console.error(`[KV Store] Error deleting task ${taskId}:`, error);
    // Or re-throw
    throw error; // Re-throw error so callers know it failed
  }
}

// We can potentially add a function to list tasks if needed,
// but kv.scan might be inefficient/costly for large datasets.
// For now, individual get/set/delete is sufficient. 