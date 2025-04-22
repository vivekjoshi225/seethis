# Website Screenshot Tool (Next.js)

A Next.js web application using Puppeteer to capture screenshots of multiple websites at various resolutions, with real-time progress updates.

## Features

*   **Batch Processing:** Input multiple URLs and multiple resolutions (WxH).
*   **Custom Wait Time:** Specify an additional delay (in milliseconds) after page load before capturing.
*   **Screenshot Modes:**
    *   `viewport`: Captures only the initially visible part of the page.
    *   `full`: Captures the entire scrollable page.
    *   `both`: Captures and saves both versions.
*   **Real-time Feedback:**
    *   Shows current task status.
    *   Displays a progress table indicating success/error for each URL/resolution combo.
*   **Download:** Provides a link to download a ZIP archive containing all captured screenshots upon completion.
*   **Vercel Compatible:** Configured to run smoothly on Vercel using Vercel KV and serverless-friendly Puppeteer.

## Local Development

1.  **Ensure you have Node.js installed.**
2.  **Clone the repository** and navigate to the project directory:
    ```bash
    git clone <repository-url>
    cd screenshot-tool
    ```
3.  **Install required dependencies:**
    ```bash
    npm install
    ```
4.  **Start the development server:**
    ```bash
    npm run dev
    ```
5.  Open your web browser and navigate to `http://localhost:4000`

## Vercel Deployment

### Prerequisites

- A [Vercel account](https://vercel.com/signup)
- A GitHub, GitLab, or Bitbucket repository with your code
- [Vercel CLI](https://vercel.com/docs/cli) (optional for local testing)

### Step 1: Connect Your Repository to Vercel

1. Push your code to GitHub, GitLab, or Bitbucket
2. Go to [vercel.com](https://vercel.com) and sign in
3. Click "Add New" → "Project"
4. Select your repository
5. Click "Import"

### Step 2: Set Up Vercel KV (Required)

1. In your Vercel dashboard, go to "Storage" in the sidebar
2. Click "Create Database" and select "KV Database"
3. Follow the setup wizard
4. After creation, Vercel will provide you with environment variables:
   - `KV_URL`
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `KV_REST_API_READ_ONLY_TOKEN`

### Step 3: Configure Environment Variables

1. In your project settings on Vercel, go to "Environment Variables"
2. Add all the KV variables from the previous step
   - These should be automatically added if you created the KV store through Vercel

### Step 4: Deploy

1. Click "Deploy" in the Vercel dashboard
2. Vercel will build and deploy your application
3. You'll get a production URL for your application

### Important Notes for Vercel Deployment

1. **Puppeteer Configuration**: The application is already configured to use `@sparticuz/chromium` and `puppeteer-core` for Vercel compatibility.

2. **File Storage**: On Vercel, screenshots are stored temporarily in the `/tmp` directory, which is ephemeral in serverless environments. This means:
   - Screenshots will be available for download during the same user session
   - They will be deleted when functions cold-start or after some time
   - For persistent storage, consider using Vercel Blob (see below)

3. **Function Limitations**:
   - Serverless function timeout: 60s by default (may need to be increased for large batches)
   - Memory limit: 1GB-4GB depending on plan
   - Concurrent executions are limited based on your plan

## Advanced: Using Vercel Blob Storage (Optional)

For production environments where you need more persistent file storage:

1. Install Vercel Blob:
   ```bash
   npm install @vercel/blob
   ```

2. Set up Blob Storage in your Vercel dashboard:
   - Go to "Storage" → "Add" → "Blob Storage"
   - Follow the setup wizard

3. Modify `process-task.ts` to upload screenshots to Blob Storage instead of saving to local file system.

## Usage

1. **Enter URLs:** Paste website URLs, one per line.
2. **Select Devices/Dimensions:** Choose from preset device dimensions or add custom ones.
3. **Set Wait Time:** Enter optional wait time in milliseconds (0-5000).
4. **Select Mode:** Choose screenshot mode (`viewport`, `fullPage`, or `both`).
5. **Click "Generate Screenshots":**
   - The server will start the task and show real-time progress.
   - Once complete, a download link for the ZIP file will appear.

## File Structure

- `/pages`: Next.js pages including API routes
- `/components`: React components
- `/lib`: Utility functions and core functionality
- `/public`: Static assets and screenshot storage (local dev only)
- `/types`: TypeScript type definitions 

## Line added just to trigger the Vercel Deployment.