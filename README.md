# Website Screenshot Tool (Standalone)

A Node.js web application using Express and Puppeteer to capture screenshots of multiple websites at various resolutions, with real-time progress updates via WebSockets.

**Note:** This tool is designed to run independently. Ensure you have installed its dependencies in the main project's `node_modules` or create a dedicated `package.json` within this `screenshot-tool` directory and install them here.

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
*   **Replit Ready:** Configured to run Puppeteer smoothly on Replit (`--no-sandbox`).

## Setup & Installation

1.  **Ensure you have Node.js installed.**
2.  **Navigate to the `screenshot-tool` directory** in your terminal:
    ```bash
    cd screenshot-tool
    ```
3.  **Install required dependencies:**
    *   *If using the parent project's `node_modules`:* Ensure `express`, `ws`, `puppeteer`, `fs-extra`, `archiver`, and `uuid` are installed in the root project.
    *   *Alternatively (Recommended for separation):* Create a `package.json` inside this directory (`npm init -y`) and then run:
        ```bash
        npm install express ws puppeteer fs-extra archiver uuid
        ```
    *(Puppeteer might take a while to download Chromium the first time.)*

## Running the Application

1.  **Make sure you are inside the `screenshot-tool` directory** in your terminal.
2.  **Start the server:**
    ```bash
    node server.js
    ```
3.  Open your web browser and navigate to `http://localhost:3001/admin/manage/screenshot-tool` (or the appropriate URL if running on Replit/other hosting, using port 3001).

## Usage

1.  **Open the web interface** in your browser.
2.  **Enter URLs:** Paste website URLs, one per line.
3.  **Enter Resolutions:** Input dimensions (width x height), one per line.
4.  **Set Wait Time:** Enter optional wait time in milliseconds.
5.  **Select Mode:** Choose screenshot mode (`viewport`, `full`, or `both`).
6.  **Click "Generate Screenshots":**
    *   The server will start the task.
    *   The status text and progress table will update in real-time.
    *   Cells turn green for success, red for error.
    *   Once complete, a download link for `screenshots_<taskId>.zip` will appear.
    *   Screenshots inside the zip are named like: `[hostname]_[width]x[height]_[mode].png`.

## File Structure

*   `server.js`: The Express/WebSocket application logic.
*   `index.html`: The frontend HTML form and WebSocket client.
*   `public/`: Directory for temporary task files.
    *   `task_screenshots/`: Temporary storage for generated screenshots (one subdir per task).
    *   `zips/`: Temporary storage for generated zip files.
*   `README.md`: This file. 