import type { NextApiRequest, NextApiResponse } from 'next';
import archiver from 'archiver';
import fs from 'fs-extra';
import path from 'path';
import taskStore from '@/lib/task-store';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { taskId } = req.query;

  if (!taskId || typeof taskId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid taskId query parameter.' });
  }

  const task = taskStore.get(taskId);

  if (!task) {
    return res.status(404).json({ error: `Task with ID ${taskId} not found.` });
  }

  // Only allow download if task is completed or partially completed
  if (task.status !== 'completed' && task.status !== 'partially_completed') {
    return res.status(400).json({ error: `Task ${taskId} is not yet complete. Current status: ${task.status}` });
  }

  const directoryToZip = task.taskSpecificDir;
  if (!fs.existsSync(directoryToZip)) {
      console.error(`[API /download-zip] Directory not found for task ${taskId}: ${directoryToZip}`);
      return res.status(500).json({ error: 'Task output directory not found.' });
  }

  const zipFilename = `screenshots_${taskId}.zip`;
  
  try {
    console.log(`[API /download-zip] Creating zip for task ${taskId} from dir: ${directoryToZip}`);
    
    // Set headers for file download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${zipFilename}`);

    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });

    // Handle warnings and errors during archiving
    archive.on('warning', function(err: archiver.ArchiverError) {
      if (err.code === 'ENOENT') {
        console.warn(`[Archiver Warning - Task ${taskId}]: ${err}`);
      } else {
        console.error(`[Archiver Error - Task ${taskId}]: ${err}`);
        // Don't throw here, let it try to finish
      }
    });

    archive.on('error', function(err: Error) {
      console.error(`[Archiver Error - Task ${taskId}]: Critical error during zip creation: ${err}`);
      // Ensure response ends if headers not sent yet
      if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to create zip file.'});
      } else {
          res.end(); // End the stream if possible
      }
    });

    // Pipe the archive data to the response
    archive.pipe(res);

    // Add the directory contents to the zip archive
    // The second argument is the path prefix inside the zip file (false means no prefix)
    archive.directory(directoryToZip, false);

    // Finalize the archive (writes the central directory)
    await archive.finalize();
    console.log(`[API /download-zip] Zip file for task ${taskId} finalized and sent.`);

    // --- Cleanup --- 
    // Optionally clean up the task directory after successful download
    // Be cautious with cleanup; if the user needs to download again, it will fail.
    // Consider a separate cleanup mechanism or delaying cleanup.
    // console.log(`[API /download-zip] Cleaning up directory for task ${taskId}: ${directoryToZip}`);
    // fs.remove(directoryToZip).catch(err => {
    //     console.error(`[API /download-zip] Error cleaning up directory ${directoryToZip}:`, err);
    // });
    // Task removal from store might happen here or elsewhere (e.g., after a TTL)
    // taskStore.delete(taskId);

  } catch (error: any) {
    console.error(`[API /download-zip] Failed to create or send zip for task ${taskId}:`, error);
     if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create or send zip file.', details: error.message });
     } else {
         res.end();
     }
  }
} 