import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { getTask } from '@/lib/task-store';

// Detect Vercel environment
const isVercelProduction = process.env.VERCEL === '1';

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
    console.log(`[API /download-zip] Environment: ${isVercelProduction ? 'Vercel' : 'Local'}`);
    
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
    const originalTaskDir = task.taskSpecificDir;
    console.log(`[API /download-zip] Original task directory: ${originalTaskDir}`);
    
    // In Vercel, we need to look in /tmp instead of the original path
    const vercelTaskDir = path.join('/tmp/task_screenshots', taskId);
    
    // Try the appropriate directory first based on environment
    const primaryDir = isVercelProduction ? vercelTaskDir : originalTaskDir;
    const fallbackDir = isVercelProduction ? originalTaskDir : vercelTaskDir;
    
    console.log(`[API /download-zip] Trying primary directory: ${primaryDir}`);
    
    // Check if the primary directory exists
    let taskDir: string;
    if (fs.existsSync(primaryDir)) {
      console.log(`[API /download-zip] Primary directory exists: ${primaryDir}`);
      taskDir = primaryDir;
    } else {
      console.warn(`[API /download-zip] Primary directory not found, trying fallback: ${fallbackDir}`);
      if (fs.existsSync(fallbackDir)) {
        console.log(`[API /download-zip] Fallback directory exists: ${fallbackDir}`);
        taskDir = fallbackDir;
      } else {
        console.error(`[API /download-zip] Both primary and fallback directories not found`);
        
        // For debugging - list contents of possible parent directories
        const possibleParentDirs = [
          path.join(process.cwd(), 'public', 'task_screenshots'),
          '/tmp/task_screenshots'
        ];
        
        for (const dir of possibleParentDirs) {
          if (fs.existsSync(dir)) {
            console.log(`[API /download-zip] Contents of ${dir}:`, fs.readdirSync(dir));
          } else {
            console.error(`[API /download-zip] Directory doesn't exist: ${dir}`);
          }
        }
        
        return res.status(404).json({ 
          error: 'Screenshots directory not found', 
          details: 'Could not locate the directory containing screenshot files.'
        });
      }
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