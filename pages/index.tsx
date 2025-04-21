import Head from 'next/head';
import { useState, useEffect, useRef } from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Toaster, toast } from 'sonner';
import { Loader2, CheckCircle2, XCircle, ExternalLink, Download, AlertTriangle } from 'lucide-react';
import { ScreenshotJob, ScreenshotStatus, TaskStatus, TaskStatusResponse } from '@/types/screenshot';

// --- Constants ---
const POLLING_INTERVAL = 3000; // Poll every 3 seconds

// --- Types (Keep Form Schema) ---
const formSchema = z.object({
  urls: z.string().min(1, 'Please enter at least one URL.'),
  width: z.coerce.number().min(100, 'Width must be at least 100').max(5000, 'Width cannot exceed 5000').default(1920),
  height: z.coerce.number().min(100, 'Height must be at least 100').max(5000, 'Height cannot exceed 5000').default(1080),
  fullPage: z.boolean().default(false),
});
type FormData = z.infer<typeof formSchema>;

// --- Component ---
export default function Home() {
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);
  const [jobs, setJobs] = useState<ScreenshotJob[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [overallError, setOverallError] = useState<string | null>(null);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      urls: '',
      width: 1920,
      height: 1080,
      fullPage: false,
    },
  });

  // --- Polling Logic ---
  useEffect(() => {
    // Function to fetch task status
    const fetchStatus = async () => {
      if (!currentTaskId || !isPolling) {
          stopPolling();
          return;
      }

      console.log(`Polling status for task: ${currentTaskId}`);
      try {
        const response = await fetch(`/api/task-status?taskId=${currentTaskId}`);
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        const data: TaskStatusResponse = await response.json();

        // Update state first
        setTaskStatus(data.status);
        setJobs(data.jobs || []);
        setOverallError(data.error || null);

        // Check if task is finished and update polling state to stop it
        if (data.status === 'completed' || data.status === 'partially_completed' || data.status === 'error') {
            console.log(`Task ${currentTaskId} finished with status: ${data.status}. Stopping polling.`);
            setIsPolling(false);
            if (data.status === 'completed') toast.success('All screenshots generated successfully!');
            else if (data.status === 'partially_completed') toast.warning('Some screenshots failed. Check results.');
            else if (data.status === 'error') toast.error(`Task failed: ${data.error || 'Unknown error'}`);
        }
      } catch (error: any) {
        console.error('Error fetching task status:', error);
        toast.error(`Failed to get task status: ${error.message}`);
        setOverallError(`Failed to get task status: ${error.message}`);
        setIsPolling(false);
      }
    };

    // Function to clear interval (remains the same)
    const stopPolling = () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
          console.log(`Polling interval cleared for task: ${currentTaskId}`);
        }
    };

    // Start polling only if we have a task ID and polling is enabled
    if (currentTaskId && isPolling) {
      fetchStatus(); // Fetch immediately
      stopPolling();
      pollingIntervalRef.current = setInterval(fetchStatus, POLLING_INTERVAL);
      console.log(`Polling interval set for task: ${currentTaskId}`);
    } else {
        stopPolling();
    }

    // Cleanup function to clear interval when component unmounts or dependencies change
    return () => {
        stopPolling();
    };
  }, [currentTaskId, isPolling]);

  // --- Form Submission ---
  const onSubmit: SubmitHandler<FormData> = async (data) => {
    setIsSubmitting(true);
    setOverallError(null);
    setCurrentTaskId(null); // Reset previous task
    setJobs([]);
    setTaskStatus(null);
    setIsPolling(false); // Stop polling

    const requestedUrls = data.urls.split('\n').map(url => url.trim()).filter(url => url.length > 0);

    if (requestedUrls.length === 0) {
      toast.error('No valid URLs provided.');
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch('/api/start-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          urls: requestedUrls, 
          width: data.width, 
          height: data.height, 
          fullPage: data.fullPage 
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const { taskId } = await response.json();
      console.log("Task started with ID:", taskId);
      toast.info(`Task ${taskId} started for ${requestedUrls.length} URLs.`);
      
      // Set the task ID and start polling
      setCurrentTaskId(taskId);
      setIsPolling(true);
      // Initial jobs state (optional, status endpoint will populate it)
      setJobs(requestedUrls.map((url, index) => ({
          id: `${taskId}-${index}`, 
          url, 
          width: data.width, 
          height: data.height, 
          fullPage: data.fullPage,
          status: 'pending' 
      })));
      setTaskStatus('pending');

    } catch (error: any) {
      console.error('Failed to start task:', error);
      toast.error(`Failed to start task: ${error.message}`);
      setOverallError(`Failed to start task: ${error.message}`);
    } finally {
      setIsSubmitting(false);
      // Don't reset form here, user might want to adjust and resubmit
    }
  };

  // --- Rendering Logic ---
  const renderStatusIcon = (status: ScreenshotStatus) => {
    switch (status) {
      case 'pending':
        return <span className="text-gray-400 italic text-xs">Pending</span>;
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-400" />;
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-400" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-400" />;
      default:
        return null;
    }
  };

  const isTaskActive = taskStatus === 'pending' || taskStatus === 'processing';
  const canDownload = taskStatus === 'completed' || taskStatus === 'partially_completed';

  return (
    <div className="flex flex-col items-center min-h-screen py-10 px-4 bg-gradient-to-br from-gray-900 via-purple-900 to-indigo-900 text-gray-100">
      <Head>
        <title>PixelPerfect | Batch Screenshot Tool</title>
        <link rel="icon" href="/favicon.ico" /> {/* TODO: Add a nice favicon */}
      </Head>
      <Toaster richColors position="top-center" />

      <main className="flex flex-col items-center w-full max-w-6xl space-y-10">
        <h1 className="text-4xl sm:text-5xl font-bold text-center tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">
          PixelPerfect Batch Screenshots
        </h1>
        <p className="text-lg text-indigo-300 text-center">
          Enter multiple URLs, set dimensions, and download all screenshots as a ZIP.
        </p>

        {/* --- Configuration Card --- */} 
        <Card className="w-full bg-white/5 backdrop-blur-lg border-white/10 text-gray-100 shadow-xl">
          <CardHeader>
            <CardTitle className="text-2xl">Configuration</CardTitle>
            <CardDescription className="text-indigo-300">
              Enter one URL per line. All URLs will use the same dimensions/options.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              {/* Form Inputs (similar to before) */} 
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-3">
                    <Label htmlFor="urls" className="text-indigo-200">URLs (One per line)</Label>
                    <Textarea
                      id="urls"
                      placeholder="https://example.com\nhttps://google.com\nhttps://github.com"
                      className="mt-1 bg-black/20 border-white/20 placeholder:text-indigo-400/60 focus:border-indigo-400 focus:ring-indigo-400 text-gray-100"
                      rows={5}
                      {...register('urls')}
                      disabled={isSubmitting || isPolling}
                    />
                    {errors.urls && <p className="text-red-400 text-sm mt-1">{errors.urls.message}</p>}
                  </div>
                  <div>
                    <Label htmlFor="width" className="text-indigo-200">Width (px)</Label>
                    <Input
                      id="width"
                      type="number"
                      placeholder="1920"
                      className="mt-1 bg-black/20 border-white/20 placeholder:text-indigo-400/60 focus:border-indigo-400 focus:ring-indigo-400 text-gray-100"
                      {...register('width')}
                      disabled={isSubmitting || isPolling}
                    />
                    {errors.width && <p className="text-red-400 text-sm mt-1">{errors.width.message}</p>}
                  </div>
                  <div>
                    <Label htmlFor="height" className="text-indigo-200">Height (px)</Label>
                    <Input
                      id="height"
                      type="number"
                      placeholder="1080"
                      className="mt-1 bg-black/20 border-white/20 placeholder:text-indigo-400/60 focus:border-indigo-400 focus:ring-indigo-400 text-gray-100"
                      {...register('height')}
                      disabled={isSubmitting || isPolling}
                    />
                    {errors.height && <p className="text-red-400 text-sm mt-1">{errors.height.message}</p>}
                  </div>
                  <div className="flex items-center space-x-2 md:col-span-1 pt-5">
                     <Checkbox
                       id="fullPage"
                       className="border-indigo-400 data-[state=checked]:bg-purple-500 data-[state=checked]:text-white"
                       {...register('fullPage')}
                       disabled={isSubmitting || isPolling}
                     />
                     <Label htmlFor="fullPage" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-indigo-200">
                       Capture Full Page?
                     </Label>
                  </div>
              </div>
            </CardContent>
            <CardFooter className="border-t border-white/10 pt-6 flex justify-between items-center">
              <Button
                type="submit"
                disabled={isSubmitting || isPolling}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold text-lg py-3 px-8 transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting || isPolling ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Processing Task...
                  </>
                ) : (
                  'Generate Screenshots'
                )}
              </Button>
               {/* Download Button - shown when task is done */} 
               {currentTaskId && canDownload && (
                    <Button
                        variant="outline"
                        className="bg-green-600 hover:bg-green-700 text-white border-green-700 font-semibold py-3 px-6"
                        asChild
                    >
                        <a href={`/api/download-zip?taskId=${currentTaskId}`}>
                            <Download className="mr-2 h-5 w-5" /> Download ZIP
                        </a>
                    </Button>
                )}
            </CardFooter>
          </form>
        </Card>

        {/* --- Results Card --- */} 
        {(currentTaskId || overallError) && (
          <Card className="w-full bg-white/5 backdrop-blur-lg border-white/10 text-gray-100 shadow-xl">
            <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                      <CardTitle className="text-2xl">Task Results</CardTitle>
                      {currentTaskId && <CardDescription className="text-indigo-300 mt-1">Task ID: {currentTaskId} | Status: <span className={`font-semibold ${taskStatus === 'completed' ? 'text-green-400' : taskStatus === 'error' ? 'text-red-400' : 'text-blue-400'}`}>{taskStatus || 'N/A'}</span></CardDescription>}
                  </div>
                   {/* Show Download Button here too if preferred */} 
                   {currentTaskId && canDownload && (
                        <Button
                            variant="outline"
                            className="bg-green-600 hover:bg-green-700 text-white border-green-700 font-semibold py-2 px-4"
                            asChild
                        >
                            <a href={`/api/download-zip?taskId=${currentTaskId}`}>
                                <Download className="mr-2 h-4 w-4" /> Download ZIP
                            </a>
                        </Button>
                    )}
              </div>
              {overallError && (
                <div className="mt-4 p-3 bg-red-900/50 border border-red-700 rounded-md text-red-300 flex items-center">
                    <AlertTriangle className="h-5 w-5 mr-2" />
                    <span>Overall Task Error: {overallError}</span>
                </div>
              )}
            </CardHeader>
            {jobs.length > 0 && (
                <CardContent>
                <Table>
                    <TableHeader>
                    <TableRow className="border-white/20 hover:bg-white/10">
                        <TableHead className="w-[50%] text-indigo-200">URL</TableHead>
                        {/* <TableHead className="text-indigo-200">Dimensions</TableHead> */}
                        <TableHead className="text-center text-indigo-200">Status</TableHead>
                        <TableHead className="text-right text-indigo-200">Result / Message</TableHead>
                    </TableRow>
                    </TableHeader>
                    <TableBody>
                    {jobs.map((job) => (
                        <TableRow key={job.id} className="border-white/10 hover:bg-white/5">
                        <TableCell className="font-medium truncate max-w-md" title={job.url}>
                            {job.url}
                        </TableCell>
                        {/* <TableCell>{job.width}x{job.height} {job.fullPage ? '(Full)' : ''}</TableCell> */}
                        <TableCell className="text-center">{renderStatusIcon(job.status)}</TableCell>
                        <TableCell className="text-right text-sm">
                            {job.status === 'completed' && job.imageUrl && (
                                <a href={job.imageUrl} target="_blank" rel="noopener noreferrer" title="View Screenshot" className="text-blue-400 hover:text-blue-300 hover:underline inline-flex items-center">
                                    View Image <ExternalLink className="h-3 w-3 ml-1" />
                                </a>
                            )}
                            {job.status === 'error' && (
                            <span className="text-red-400" title={job.message}>{job.message || 'Error'}</span>
                            )}
                        </TableCell>
                        </TableRow>
                    ))}
                    </TableBody>
                </Table>
                </CardContent>
            )}
          </Card>
        )}
      </main>
    </div>
  );
} 