import { z } from 'zod';

export type ScreenshotStatus = 'pending' | 'processing' | 'completed' | 'error';

export interface ScreenshotJob {
  id: string; // Unique identifier for this specific screenshot job (e.g., taskId-url-dimension-type)
  url: string;
  dimension: string; // e.g., "1920x1080"
  screenshotType: 'viewport' | 'fullPage'; // Type of screenshot taken
  status: ScreenshotStatus;
  waitMs?: number; // Optional delay in milliseconds before taking screenshot
  imageUrl?: string; // URL to the stored image (if completed)
  message?: string; // Error message (if error)
}

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'error' | 'partially_completed' | 'cancelling' | 'cancelled';

export interface ScreenshotTask {
  taskId: string;
  status: TaskStatus;
  jobs: ScreenshotJob[];
  createdAt: number;
  taskSpecificDir: string; // Full path on server
  zipPath?: string; // Full path to the zip file when created
  error?: string; // Overall task error
}

// Interface for the /api/start-task request body
export const startTaskSchema = z.object({
  urls: z.array(z.string().url({ message: "Invalid URL format provided." })).min(1, "At least one URL is required."),
  dimensions: z.array(z.string().regex(/^\d+x\d+$/, { message: "Invalid dimension format. Use WxH (e.g., 1920x1080)." })).min(1, "At least one dimension is required."),
  screenshotType: z.enum(['viewport', 'fullPage', 'both']),
  waitMs: z.coerce.number().int().min(0, 'Wait time must be 0 or greater').max(5000, 'Wait time cannot exceed 5000ms').optional().default(0),
});

export type StartTaskPayload = z.infer<typeof startTaskSchema>;

// Interface for the /api/task-status response
export interface TaskStatusResponse {
  taskId: string;
  status: TaskStatus;
  jobs: ScreenshotJob[]; // Array of individual jobs within the task
  error?: string | null; // Overall task error, if any
  zipReady?: boolean; // Indicate if zip file is ready for download
} 