import { ScreenshotTask } from '@/types/screenshot';

// Use globalThis for type safety and broader compatibility (Node/browser)
declare global {
  // eslint-disable-next-line no-var
  var taskStoreInstance: Map<string, ScreenshotTask> | undefined;
}

// Initialize the store on the global object if it doesn't exist
if (!globalThis.taskStoreInstance) {
  console.log('[task-store] Initializing global task store Map.');
  globalThis.taskStoreInstance = new Map<string, ScreenshotTask>();
}

const taskStore = globalThis.taskStoreInstance;

export default taskStore; 