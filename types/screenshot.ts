export type ScreenshotStatus = 'pending' | 'processing' | 'completed' | 'error';

export interface ScreenshotJob {
  id: string; // Unique ID for this specific url + config combo
  url: string;
  width: number;
  height: number;
  fullPage: boolean;
  status: ScreenshotStatus;
  message?: string; // Error message
  imageUrl?: string; // Relative path to the saved image
}

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'error' | 'partially_completed';

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
export interface StartTaskPayload {
  urls: string[];
  width: number;
  height: number;
  fullPage: boolean;
  // Add other options here if needed
}

// Interface for the /api/task-status response
export interface TaskStatusResponse {
  taskId: string;
  status: TaskStatus;
  jobs: ScreenshotJob[]; // Send job status updates
  error?: string;
  zipReady?: boolean; // Indicate if zip file is ready for download
} 