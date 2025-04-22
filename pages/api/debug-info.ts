import type { NextApiRequest, NextApiResponse } from 'next';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Define proper interfaces for debug info structure
interface PuppeteerInfo {
  installed: boolean;
  chromiumFound: boolean;
  sparticuzChromiumFound: boolean;
  puppeteerCoreFound?: boolean;
  [key: string]: any;
}

interface FileSystemInfo {
  tmpExists: boolean;
  tmpWritable: boolean;
  publicExists: boolean;
  publicWritable: boolean;
  tmpError?: string;
  publicError?: string;
  taskScreenshotsExists?: boolean;
  tmpScreenshotsExists?: boolean;
  taskScreenshotsContents?: string[];
  tmpScreenshotsContents?: string[];
  taskScreenshotsError?: string;
  tmpScreenshotsError?: string;
  [key: string]: any;
}

interface EnvironmentInfo {
  nodeVersion: string;
  platform: string;
  arch: string;
  isVercel: boolean;
  cwd: string;
  env: string;
  memoryUsage: NodeJS.MemoryUsage;
  [key: string]: any;
}

interface OsInfo {
  platform: string;
  release: string;
  type: string;
  totalMemory: number;
  freeMemory: number;
  uptime: number;
  loadAvg: number[];
  [key: string]: any;
}

interface DebugInfo {
  timestamp: string;
  environment: EnvironmentInfo;
  os: OsInfo;
  puppeteer: PuppeteerInfo;
  fileSystem: FileSystemInfo;
  [key: string]: any;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // This endpoint collects system information to help debug Vercel deployment issues
  try {
    // Collect system information
    const debugInfo: DebugInfo = {
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        isVercel: process.env.VERCEL === '1',
        cwd: process.cwd(),
        env: process.env.NODE_ENV || 'unknown',
        memoryUsage: process.memoryUsage(),
      },
      os: {
        platform: os.platform(),
        release: os.release(),
        type: os.type(),
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        uptime: os.uptime(),
        loadAvg: os.loadavg(),
      },
      puppeteer: {
        installed: true,
        chromiumFound: false, // Will be updated below
        sparticuzChromiumFound: false, // Will be updated below
      },
      fileSystem: {
        tmpExists: false,
        tmpWritable: false,
        publicExists: false,
        publicWritable: false,
      }
    };

    // Check for puppeteer packages
    try {
      require.resolve('puppeteer');
    } catch (e) {
      debugInfo.puppeteer.installed = false;
    }

    try {
      require.resolve('puppeteer-core');
      debugInfo.puppeteer.puppeteerCoreFound = true;
    } catch (e) {
      debugInfo.puppeteer.puppeteerCoreFound = false;
    }

    try {
      require.resolve('@sparticuz/chromium');
      debugInfo.puppeteer.sparticuzChromiumFound = true;
    } catch (e) {
      debugInfo.puppeteer.sparticuzChromiumFound = false;
    }

    // Check directory existence and writability
    const tmpDir = '/tmp';
    const publicDir = path.join(process.cwd(), 'public');

    // Check tmp directory
    if (fs.existsSync(tmpDir)) {
      debugInfo.fileSystem.tmpExists = true;
      try {
        const testPath = path.join(tmpDir, `test-${Date.now()}.txt`);
        fs.writeFileSync(testPath, 'test');
        fs.unlinkSync(testPath);
        debugInfo.fileSystem.tmpWritable = true;
      } catch (error: any) {
        debugInfo.fileSystem.tmpWritable = false;
        debugInfo.fileSystem.tmpError = error.message;
      }
    }

    // Check public directory
    if (fs.existsSync(publicDir)) {
      debugInfo.fileSystem.publicExists = true;
      try {
        const testPath = path.join(publicDir, `test-${Date.now()}.txt`);
        fs.writeFileSync(testPath, 'test');
        fs.unlinkSync(testPath);
        debugInfo.fileSystem.publicWritable = true;
      } catch (error: any) {
        debugInfo.fileSystem.publicWritable = false;
        debugInfo.fileSystem.publicError = error.message;
      }
    }

    // Check key paths
    const taskScreenshotsPath = path.join(process.cwd(), 'public', 'task_screenshots');
    const tmpScreenshotsPath = path.join('/tmp', 'task_screenshots');
    
    debugInfo.fileSystem.taskScreenshotsExists = fs.existsSync(taskScreenshotsPath);
    debugInfo.fileSystem.tmpScreenshotsExists = fs.existsSync(tmpScreenshotsPath);
    
    // List directories if they exist
    if (debugInfo.fileSystem.taskScreenshotsExists) {
      try {
        debugInfo.fileSystem.taskScreenshotsContents = fs.readdirSync(taskScreenshotsPath);
      } catch (error: any) {
        debugInfo.fileSystem.taskScreenshotsError = error.message;
      }
    }
    
    if (debugInfo.fileSystem.tmpScreenshotsExists) {
      try {
        debugInfo.fileSystem.tmpScreenshotsContents = fs.readdirSync(tmpScreenshotsPath);
      } catch (error: any) {
        debugInfo.fileSystem.tmpScreenshotsError = error.message;
      }
    }

    // Send response
    res.status(200).json(debugInfo);
  } catch (error: any) {
    res.status(500).json({ 
      error: 'Error collecting debug information', 
      message: error.message,
      stack: error.stack
    });
  }
} 