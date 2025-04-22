import Head from 'next/head';
import React, { useState, useEffect, useRef } from 'react';
import { useForm, SubmitHandler, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DeviceDimensionInput } from '@/components/ui/device-dimension-input';
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
import { Loader2, CheckCircle2, XCircle, ExternalLink, Download, AlertTriangle, Ban } from 'lucide-react';
import { ScreenshotJob, ScreenshotStatus, TaskStatus, TaskStatusResponse } from '@/types/screenshot';
import { POPULAR_DEVICES } from '@/constants/devices'; // Import device data

// --- Constants ---
const POLLING_INTERVAL = 3000; // Poll every 3 seconds
const dimensionRegex = /^\d+x\d+$/; // Keep for potential manual input in future? Or remove? For now, keep but validation changes.

// --- Default Form Values ---
const DEFAULT_FORM_VALUES = {
  urls: `https://craftedfolio.com/portfolio/vivek-joshi
https://craftedfolio.com/portfolio/john-doe`,
  dimensions: '', // Start with no devices selected
  screenshotType: 'viewport' as 'viewport' | 'fullPage' | 'both', // Ensure type correctness
  waitMs: 3000,
};

// --- Update Form Schema ---
const formSchema = z.object({
  urls: z.string().min(1, 'Please enter at least one URL.'),
  dimensions: z.string().min(1, 'Please select at least one device or enter a dimension.') // Simplified validation
    .refine(value => {
        // Allow empty or newline-separated WxH dimensions
        const lines = value.split('\\n').map(d => d.trim()).filter(d => d.length > 0);
        return lines.every(line => dimensionRegex.test(line));
    }, 'Invalid dimension format detected. Use WxH if manually entering.'), // Keep basic format check?
  screenshotType: z.enum(['viewport', 'fullPage', 'both']).default(DEFAULT_FORM_VALUES.screenshotType), // Use default from const
  waitMs: z.coerce.number().int().min(0).max(7000).optional().default(DEFAULT_FORM_VALUES.waitMs), // Use default from const
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
  // State to hold dimensions/type *after* successful submission for table rendering
  const [submittedDimensions, setSubmittedDimensions] = useState<string[]>([]);
  const [submittedScreenshotType, setSubmittedScreenshotType] = useState<'viewport' | 'fullPage' | 'both' | null>(null);
  const [isCancelling, setIsCancelling] = useState(false); // State for cancellation UI

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Create a reverse map for quick dimension -> name lookup
  const dimensionToNameMap = React.useMemo(() => {
      const map = new Map<string, string>();
      POPULAR_DEVICES.forEach(device => {
          map.set(device.dimension, device.name);
      });
      return map;
  }, []); // Empty dependency array ensures this runs only once

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    control, // Need control for RadioGroup
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    // Initialize useForm with the default values object
    defaultValues: DEFAULT_FORM_VALUES, 
  });

  // --- Polling Logic ---
  useEffect(() => {
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
        // Ensure the fetched data matches the expected response type
        const data: TaskStatusResponse = await response.json(); 

        // Update state
        setTaskStatus(data.status);
        setJobs(data.jobs || []); // Use jobs array from response
        setOverallError(data.error || null);

        // Stop polling check - ADD 'cancelled' to the list of final statuses
        const finalStatuses: TaskStatus[] = ['completed', 'partially_completed', 'error', 'cancelled'];
        if (finalStatuses.includes(data.status)) {
            console.log(`Task ${currentTaskId} reached final status: ${data.status}. Stopping polling.`);
            setIsPolling(false); // Stop polling
            // Display appropriate toast message based on final status
            if (data.status === 'completed') toast.success('All screenshots generated successfully!');
            else if (data.status === 'partially_completed') toast.warning('Some screenshots failed. Check results.');
            else if (data.status === 'error') toast.error(`Task failed: ${data.error || 'Unknown error'}`);
            else if (data.status === 'cancelled') toast.info(`Task ${currentTaskId} was cancelled.`); // Add toast for cancelled
        }
      } catch (error: any) {
        console.error('Error fetching task status:', error);
        toast.error(`Failed to get task status: ${error.message}`);
        setOverallError(`Failed to get task status: ${error.message}`);
        setIsPolling(false); // Stop polling on error
      }
    };

    const stopPolling = () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
          console.log(`Polling interval cleared for task: ${currentTaskId}`);
        }
    };

    if (currentTaskId && isPolling) {
      fetchStatus(); // Fetch immediately
      pollingIntervalRef.current = setInterval(fetchStatus, POLLING_INTERVAL);
      console.log(`Polling interval set for task: ${currentTaskId}`);
    } else {
        stopPolling(); // Clear interval if no task or not polling
    }

    return () => { // Cleanup
        stopPolling();
    };
  }, [currentTaskId, isPolling]); // Dependencies

  // --- Form Submission ---
  const onSubmit: SubmitHandler<FormData> = async (data) => {
    setIsSubmitting(true);
    setOverallError(null);
    setCurrentTaskId(null); // Reset previous task ID
    setJobs([]); // Clear previous jobs
    setTaskStatus(null); // Reset task status
    setIsPolling(false); // Ensure polling is stopped
    setSubmittedDimensions([]); // Clear submitted dimensions for table
    setSubmittedScreenshotType(null); // Clear submitted type for table
    setIsCancelling(false); // Reset cancelling state on new submission

    // Parse URLs - Use correct newline split and deduplicate
    const uniqueRequestedUrls = Array.from(new Set(data.urls.split('\n').map(url => url.trim()).filter(url => url.length > 0 && url.startsWith('http')))); // Basic validation
    if (uniqueRequestedUrls.length === 0) {
      toast.error('No valid URLs provided (must start with http/https).');
      setIsSubmitting(false);
      return;
    }

    // Get Dimensions - Use correct newline split and deduplicate
    const uniqueRequestedDimensions = Array.from(new Set(
        data.dimensions.split('\n')
                      .map(d => d.trim())
                      .filter(d => dimensionRegex.test(d))
    )); 
    // No need for separate length check here as Zod ensures at least one valid line exists

    // Set submitted state *before* API call using UNIQUE values
    setSubmittedDimensions(uniqueRequestedDimensions); 
    setSubmittedScreenshotType(data.screenshotType);

    // Set placeholder status/jobs immediately using UNIQUE values
    setTaskStatus('pending'); 
    setJobs(uniqueRequestedUrls.flatMap(url => 
        uniqueRequestedDimensions.flatMap(dim => { // Use unique dimensions
            const jobsForDim: Partial<ScreenshotJob>[] = [];
            const baseJobId = `${url}-${dim}`.replace(/[^a-zA-Z0-9-_]/g, '_');
            if (data.screenshotType === 'viewport' || data.screenshotType === 'both') {
                jobsForDim.push({ id: `temp-${baseJobId}-vp`, url, dimension: dim, screenshotType: 'viewport', status: 'pending', waitMs: data.waitMs });
            }
            if (data.screenshotType === 'fullPage' || data.screenshotType === 'both') {
                jobsForDim.push({ id: `temp-${baseJobId}-fp`, url, dimension: dim, screenshotType: 'fullPage', status: 'pending', waitMs: data.waitMs });
            }
            return jobsForDim as ScreenshotJob[];
        })
    ));

    // --- API Call ---
    try {
      const response = await fetch('/api/start-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          urls: uniqueRequestedUrls, // Send unique URLs
          dimensions: uniqueRequestedDimensions, // Send unique dimensions
          screenshotType: data.screenshotType, 
          waitMs: data.waitMs 
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const { taskId } = await response.json();
      console.log("Task started with ID:", taskId);
      toast.info(`Task ${taskId} started.`);
      
      // Set the task ID and start polling
      setCurrentTaskId(taskId);
      setIsPolling(true); 
      // Note: The jobs state is already set with placeholders. 
      // The first poll response will overwrite these with actual job data from the backend.

    } catch (error: any) {
      console.error('Failed to start task:', error);
      toast.error(`Failed to start task: ${error.message}`);
      setOverallError(`Failed to start task: ${error.message}`);
      // Reset state fully on API error
      setJobs([]); 
      setTaskStatus(null);
      setSubmittedDimensions([]);
      setSubmittedScreenshotType(null);
      setCurrentTaskId(null);
      setIsPolling(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Cancel Task Handler ---
  const handleCancelTask = async () => {
    if (!currentTaskId) return;

    setIsCancelling(true);
    toast.loading(`Attempting to cancel task ${currentTaskId}...`, { id: `cancel-${currentTaskId}` });

    try {
      const response = await fetch('/api/cancel-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: currentTaskId }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send cancellation request.');
      }

      // Optionally update local status for faster feedback, though polling will confirm
      setTaskStatus('cancelling'); 
      toast.success(`Task ${currentTaskId} cancellation initiated.`, { id: `cancel-${currentTaskId}` });
      console.log(`[Cancel Handler] Cancellation requested for task ${currentTaskId}`);
      // The background task should eventually set the final 'cancelled' status via polling

    } catch (error: any) {
      console.error('Failed to cancel task:', error);
      toast.error(`Failed to cancel task: ${error.message}`, { id: `cancel-${currentTaskId}` });
    } finally {
      setIsCancelling(false); // Reset cancelling state regardless of outcome
    }
  };

  // --- Rendering Logic ---
  const renderStatusIcon = (status: ScreenshotStatus | undefined | TaskStatus) => { // Allow TaskStatus too
    switch (status) {
      case 'pending':
        return <span className="text-muted-foreground italic text-xs">Pending</span>;
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'cancelled':
      case 'cancelling':
        return <Ban className="h-4 w-4 text-yellow-500" />; // Use Ban icon for cancelled/cancelling
      default:
        return <span className="text-gray-400 text-xs">-</span>; 
    }
  };

  const isTaskActive = taskStatus === 'pending' || taskStatus === 'processing';
  const canDownload = taskStatus === 'completed' || taskStatus === 'partially_completed';
  const showCancelButton = isTaskActive && currentTaskId && !isCancelling;

  // Helper to get unique URLs from jobs state for table rows
  const uniqueUrls = Array.from(new Set(jobs.map(job => job.url)));

  // Helper function to find a specific job based on url, dimension, and type
  const findJob = (url: string, dimension: string, type: 'viewport' | 'fullPage'): ScreenshotJob | undefined => {
      // Find job based on all criteria. Backend MUST return these fields in the job objects.
      return jobs.find(j => j.url === url && j.dimension === dimension && j.screenshotType === type);
  };

  return (
    // Darker cyan/blue/slate theme
    <div className="flex flex-col items-center min-h-screen py-10 px-4 bg-gradient-to-br from-cyan-900 via-blue-900 to-slate-900 text-gray-100">
      <Head>
        <title>SeeThisIn | Website Visuzlization App</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <Toaster richColors position="top-right" duration={2000} />

      <main className="flex flex-col items-center w-full max-w-6xl space-y-6">
        {/* Adjust Title gradient for dark theme */}
        <h1 className="text-4xl sm:text-5xl font-bold text-center tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">
          SeeThis.in | Bulk Screen Grabber...
        </h1>
        {/* Adjust Description text color for dark theme */}
        <p className="text-lg text-blue-200 text-center">
          See the way your site looks on any screen.
        </p>

        {/* Update Card styling for dark theme - Use solid slate */}
        <Card className="w-full border border-slate-700 bg-slate-800 text-gray-100 shadow-lg"> 
          <CardHeader>
            <CardTitle className="text-2xl">Configuration</CardTitle>
            <CardDescription className="text-slate-400"> {/* Slightly muted description */}
              Enter URLs and dimensions (one per line). Select screenshot type.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              {/* Input Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* URLs Textarea */}
                  <div>
                    <Label htmlFor="urls">URLs (One per line)</Label>
                    <Textarea
                      id="urls"
                      placeholder={`https://facebook.com\nhttps://youtube.com`}
                      className="mt-1 font-mono h-28" // Monospace helps with alignment, Added h-28
                      {...register('urls')}
                      disabled={isSubmitting || isPolling}
                    />
                    {errors.urls && <p className="text-sm font-medium text-destructive mt-1">{errors.urls.message}</p>}
                  </div>

                  {/* Dimensions Input - Replaced Textarea */}
                  <div>
                    <Label htmlFor="dimensions">Devices / Dimensions</Label>
                    <Controller
                      name="dimensions"
                      control={control}
                      render={({ field }) => (
                        <DeviceDimensionInput
                          id="dimensions"
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur} // Important for validation trigger
                          disabled={isSubmitting || isPolling}
                          className="mt-1" // Add margin similar to other inputs
                          placeholder="Select devices..." // Updated placeholder
                        />
                      )}
                    />
                    {errors.dimensions && <p className="text-sm font-medium text-destructive mt-1">{errors.dimensions.message}</p>}
                  </div>
              </div>

              {/* --- Row for Screenshot Type and Wait Time --- */} 
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4">
                 {/* Screenshot Type Radio Group */}
                  <div className="space-y-2">
                     <Label>Screenshot Type</Label>
                     <Controller
                        control={control}
                        name="screenshotType"
                        render={({ field }) => (
                            <RadioGroup
                                value={field.value} 
                                onValueChange={field.onChange} 
                                className="flex flex-row gap-4 mt-1 pt-2" // Align horizontally, add padding
                                disabled={isSubmitting || isPolling}
                            >
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="viewport" id="r-viewport" />
                                    <Label htmlFor="r-viewport" className="font-normal cursor-pointer">Viewport</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="fullPage" id="r-fullpage" />
                                    <Label htmlFor="r-fullpage" className="font-normal cursor-pointer">Full Page</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="both" id="r-both" />
                                    <Label htmlFor="r-both" className="font-normal cursor-pointer">Both</Label>
                                </div>
                            </RadioGroup>
                        )}
                      />
                     {errors.screenshotType && <p className="text-sm font-medium text-destructive mt-1">{errors.screenshotType.message}</p>}
                  </div>

                  {/* Wait Time Input */}
                  <div className="space-y-2">
                     <Label htmlFor="waitMs">Wait Time (ms)</Label>
                     <Input
                        id="waitMs"
                        type="number"
                        placeholder="e.g., 500" 
                        className="mt-1"
                        min={0}
                        max={7000}
                        step={100}
                        {...register('waitMs')}
                        disabled={isSubmitting || isPolling}
                      />
                      <p className="text-xs text-muted-foreground">Delay before taking screenshot (0-7000ms).</p>
                     {errors.waitMs && <p className="text-sm font-medium text-destructive mt-1">{errors.waitMs.message}</p>}
                  </div>
              </div>

            </CardContent>
            <CardFooter className="border-t border-slate-700 pt-6 flex justify-end items-center space-x-3"> {/* Add space-x for buttons */}
              {/* Cancel Button - Shown when task is active */}
              {showCancelButton && (
                <Button
                  type="button" // Important: Prevent form submission
                  variant="outline" // Use outline style
                  className="border-red-500 text-red-400 hover:bg-red-900/20 hover:text-red-300"
                  onClick={handleCancelTask}
                  disabled={isCancelling} // Disable while cancelling request is in flight
                >
                  <Ban className="mr-2 h-4 w-4" /> Cancel Task
                </Button>
              )}
              {/* Submit/Processing Button - Add animated gradient hover */}
              <Button
                type="submit"
                disabled={isSubmitting || isPolling || isCancelling} 
                // Add classes for animated gradient effect
                className="bg-gradient-to-r from-blue-800 to-blue-500 text-white font-semibold text-lg py-3 px-8 
                           bg-[length:200%_auto] bg-[position:0%_center] hover:bg-[position:100%_center] 
                           transition-[background-position] duration-500 ease-in-out 
                           disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting || isPolling ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Processing Task...</>
                ) : (
                  'Generate Screenshots'
                )}
              </Button>
             </CardFooter>
          </form>
        </Card>

        {/* --- Results Card --- */} 
        {(currentTaskId || overallError) && (
          // Update Results Card styling for dark theme - Use solid slate 
          <Card className="w-full border border-slate-700 bg-slate-800 text-gray-100 shadow-lg overflow-x-auto"> 
            <CardHeader>
                {/* Header content: Task ID, Status, Download Button, Error */}
                <div className="flex justify-between items-center flex-wrap gap-4"> 
                  <div>
                      <CardTitle className="text-2xl">Task Results</CardTitle>
                      {currentTaskId && <CardDescription className="mt-1 text-slate-400">Task ID: {currentTaskId} | Status: <span className={`font-semibold ${taskStatus === 'completed' ? 'text-green-400' : taskStatus === 'error' || taskStatus === 'partially_completed' ? 'text-orange-400' : taskStatus === 'cancelling' || taskStatus === 'cancelled' ? 'text-yellow-500' : 'text-blue-400'}`}>{taskStatus || 'Initializing...'}</span></CardDescription>}
                  </div>
                   {/* Adjust Download button theme */}
                   {currentTaskId && canDownload && (
                        <Button
                            variant="default" // Change variant from outline
                            className="bg-cyan-500 hover:bg-cyan-600 text-white font-semibold py-2 px-4" // Apply theme colors
                            asChild
                        >
                            <a href={`/api/download-zip?taskId=${currentTaskId}`}>
                                <Download className="mr-2 h-4 w-4" /> Download ZIP
                            </a>
                        </Button>
                    )}
                </div>
                {/* Display Overall Task Error */}
                {overallError && (
                   <div className="mt-4 p-3 bg-red-900/30 border border-red-700/50 rounded-md text-red-300 flex items-center">
                       <AlertTriangle className="h-5 w-5 mr-2 flex-shrink-0" />
                       <span className="text-sm">Overall Task Error: {overallError}</span>
                   </div>
                 )}
            </CardHeader>
            
            {/* Render table ONLY if we have submitted dimensions and type */}
            {submittedDimensions.length > 0 && submittedScreenshotType && ( 
                <CardContent className="pt-0"> {/* Remove default padding */}
                  <Table className="min-w-full"> {/* Ensure table tries to fill width */}
                      <TableHeader>
                        {/* Ensure TableRow is the direct child */}
                        <TableRow> 
                          {/* Sticky URL column - Use solid hover color */}
                          <TableHead className="sticky left-0 bg-slate-800 z-10 w-[250px] lg:w-[350px] whitespace-nowrap text-slate-100 hover:bg-slate-700">URL</TableHead> 
                          
                          {/* Dynamically generate headers based on submitted dimensions/type */}
                          {submittedDimensions.map((dim) => {
                              const deviceName = dimensionToNameMap.get(dim) || dim; // Get name or fallback to dimension
                              return (
                                  <React.Fragment key={dim}> 
                                      {(submittedScreenshotType === 'viewport' || submittedScreenshotType === 'both') && (
                                          <TableHead className="text-center whitespace-nowrap hover:bg-slate-700" title={dim}>{deviceName} Viewport</TableHead>
                                      )}
                                      {(submittedScreenshotType === 'fullPage' || submittedScreenshotType === 'both') && (
                                          <TableHead className="text-center whitespace-nowrap hover:bg-slate-700" title={dim}>{deviceName} Full Page</TableHead>
                                      )}
                                  </React.Fragment>
                              );
                          })}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {/* Map through uniqueUrls to create rows */}
                        {uniqueUrls.map((url) => (
                          <TableRow key={url}>
                            {/* Sticky URL Cell - Add explicit text color */}
                            <TableCell className="sticky left-0 bg-slate-800 z-10 font-medium truncate max-w-[250px] lg:max-w-[350px] text-slate-100" title={url}> 
                              {url}
                            </TableCell>
                            
                            {/* Map through submitted dimensions again for columns */}
                            {submittedDimensions.map((dim) => (
                              <React.Fragment key={dim}>
                                  {/* Viewport Column Cell */}
                                  {(submittedScreenshotType === 'viewport' || submittedScreenshotType === 'both') && (
                                      <TableCell className="text-center px-2 py-2"> 
                                          {(() => {
                                             const job = findJob(url, dim, 'viewport'); 
                                             return (
                                                 <div className="flex flex-col items-center justify-center h-full min-h-[40px]"> 
                                                      {renderStatusIcon(job?.status)} 
                                                      {job?.status === 'completed' && job.imageUrl && (
                                                         <Button variant="link" size="sm" asChild className="h-auto p-0 text-xs text-blue-500 hover:text-blue-600 mt-0.5">
                                                             <a href={job.imageUrl} target="_blank" rel="noopener noreferrer" title="View Screenshot">
                                                                 View <ExternalLink className="h-2.5 w-2.5 ml-0.5 inline" /> 
                                                             </a>
                                                         </Button>
                                                      )}
                                                      {job?.status === 'error' && job.message && (
                                                        <span className="text-destructive text-xs mt-0.5" title={job.message}>{job.message.length > 30 ? job.message.substring(0, 27) + '...' : job.message}</span> 
                                                      )}
                                                 </div>
                                             );
                                          })()}
                                      </TableCell>
                                  )}
                                  {/* Full Page Column Cell */}
                                  {(submittedScreenshotType === 'fullPage' || submittedScreenshotType === 'both') && (
                                      <TableCell className="text-center px-2 py-2"> 
                                          {(() => {
                                              const job = findJob(url, dim, 'fullPage');
                                              return (
                                                  <div className="flex flex-col items-center justify-center h-full min-h-[40px]">
                                                      {renderStatusIcon(job?.status)} 
                                                      {job?.status === 'completed' && job.imageUrl && (
                                                          <Button variant="link" size="sm" asChild className="h-auto p-0 text-xs text-blue-500 hover:text-blue-600 mt-0.5">
                                                              <a href={job.imageUrl} target="_blank" rel="noopener noreferrer" title="View Screenshot">
                                                                  View <ExternalLink className="h-2.5 w-2.5 ml-0.5 inline" />
                                                              </a>
                                                          </Button>
                                                      )}
                                                      {job?.status === 'error' && job.message && (
                                                         <span className="text-destructive text-xs mt-0.5" title={job.message}>{job.message.length > 30 ? job.message.substring(0, 27) + '...' : job.message}</span>
                                                      )}
                                                  </div>
                                              );
                                          })()}
                                      </TableCell>
                                  )}
                              </React.Fragment>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                  </Table>
                </CardContent>
            )}
             {/* Show message if task is active but no jobs yet (e.g., during initial fetch/placeholder) */}
             {isTaskActive && jobs.length === 0 && !overallError && (
                <CardContent>
                    <div className="flex items-center justify-center p-4 text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        <span>Initializing task...</span>
                    </div>
                </CardContent>
             )}
             {/* Message if task completed/failed but no jobs found (edge case) */}
             {!isTaskActive && jobs.length === 0 && currentTaskId && !overallError && (
                 <CardContent>
                     <div className="p-4 text-center text-muted-foreground">No job results found for this task.</div>
                 </CardContent>
             )}
          </Card>
        )}
      </main>
    </div>
  );
} 