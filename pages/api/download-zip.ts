import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { getTask } from '@/lib/task-store';

// Make the handler async
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { taskId } = req.query;

  if (!taskId || Array.isArray(taskId)) {
    return res.status(400).json({ error: 'Invalid taskId parameter' });
  }

  try {
    // Get task from the KV store
    const task = await getTask(taskId);

    if (!task) {
      console.error(`[API /download-zip] Task not found: ${taskId}`);
      return res.status(404).json({ error: 'Task not found' });
    }

    // Ensure the task is in completed or partially_completed state
    if (task.status !== 'completed' && task.status !== 'partially_completed') {
      console.warn(`[API /download-zip] Task not in downloadable state: ${taskId} (status: ${task.status})`);
      return res.status(400).json({ 
        error: 'Task is not in a downloadable state',
        status: task.status 
      });
    }

    // Get the directory from the task
    const taskDir = task.taskSpecificDir;
    console.log(`[API /download-zip] Retrieved task directory from task: ${taskDir}`);

    // Verify the directory exists
    if (!fs.existsSync(taskDir)) {
      // Try a fallback path if the saved path doesn't exist
      console.warn(`[API /download-zip] Directory not found at saved path: ${taskDir}`);
      
      // Create a fallback path using the same pattern from start-task.ts
      const fallbackTaskDir = path.join(process.cwd(), 'public', 'task_screenshots', taskId);
      console.log(`[API /download-zip] Trying fallback directory: ${fallbackTaskDir}`);
      
      if (!fs.existsSync(fallbackTaskDir)) {
        console.error(`[API /download-zip] Fallback directory also not found: ${fallbackTaskDir}`);
        
        // For debugging - list contents of the base screenshot directory
        const baseDir = path.join(process.cwd(), 'public', 'task_screenshots');
        if (fs.existsSync(baseDir)) {
          console.log(`[API /download-zip] Contents of base directory ${baseDir}:`);
          const contents = fs.readdirSync(baseDir);
          console.log(contents);
        } else {
          console.error(`[API /download-zip] Base directory doesn't exist: ${baseDir}`);
        }
        
        return res.status(404).json({ 
          error: 'Screenshots directory not found', 
          details: 'Could not locate the directory containing screenshot files.'
        });
      }
      
      // Use the fallback directory if it exists
      console.log(`[API /download-zip] Using fallback directory: ${fallbackTaskDir}`);
      
      // Set response headers
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename=screenshots-${taskId}.zip`);
      
      // Create a zip archive
      const archive = archiver('zip', {
        zlib: { level: 9 } // Maximum compression
      });
      
      // Pipe archive data to the response
      archive.pipe(res);
      
      // Append files from directory
      archive.directory(fallbackTaskDir, false);
      
      // Finalize the archive
      await archive.finalize();
      console.log(`[API /download-zip] Successfully created zip for task: ${taskId} from fallback path`);
      return;
    }

    // Task directory exists, proceed with zip creation
    console.log(`[API /download-zip] Creating zip from directory: ${taskDir}`);

    // Set response headers
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=screenshots-${taskId}.zip`);

    // Create a zip archive
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    // Log warnings during archiving
    archive.on('warning', function(err) {
      console.warn(`[API /download-zip] Warning during archive creation:`, err);
    });

    // Log errors during archiving
    archive.on('error', function(err) {
      console.error(`[API /download-zip] Error during archive creation:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create archive' });
      } else {
        res.end();
      }
    });

    // Pipe archive data to the response
    archive.pipe(res);

    // List directory contents for debugging
    console.log(`[API /download-zip] Contents of directory ${taskDir}:`, fs.readdirSync(taskDir));

    // Append files from directory
    archive.directory(taskDir, false);

    // Finalize the archive
    await archive.finalize();
    console.log(`[API /download-zip] Successfully created zip for task: ${taskId} from: ${taskDir}`);
  } catch (error: any) {
    console.error(`[API /download-zip] Error processing task ${taskId}:`, error);
    // If headers have already been sent, we can't send a JSON error
    if (!res.headersSent) {
      res.status(500).json({ 
        error: `Error creating zip file: ${error.message}` 
      });
    } else {
      // Force end the response to avoid hanging
      res.end();
    }
  }
} 