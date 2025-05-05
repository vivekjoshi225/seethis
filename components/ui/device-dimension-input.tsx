import * as React from 'react';
import { X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Command as CommandPrimitive } from 'cmdk';
import { POPULAR_DEVICES, DeviceInfo } from '@/constants/devices';
import { cn } from "@/lib/utils";

// --- Component Props ---
// Removed extends React.InputHTMLAttributes<HTMLInputElement> to fix onChange conflict
// Added className explicitly
interface DeviceDimensionInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string; // Added placeholder prop explicitly
  id?: string; // Added id prop explicitly
  onBlur?: React.FocusEventHandler<HTMLInputElement>; // Use standard event handler type
}

export const DeviceDimensionInput = React.forwardRef<
    HTMLInputElement, // Keep the ref type pointing to the underlying input
    DeviceDimensionInputProps
>(({ value, onChange, disabled, className, placeholder, id, onBlur }, ref) => {

    const commandRef = React.useRef<HTMLDivElement>(null); // Ref for the outer Command component
    const inputRef = React.useRef<HTMLInputElement>(null);
    // Combine refs if necessary, or pass the forwarded ref directly to the primitive input
    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    const [inputValue, setInputValue] = React.useState('');
    const [selectedDevices, setSelectedDevices] = React.useState<DeviceInfo[]>([]);
    const [isOpen, setIsOpen] = React.useState(false); // Renamed for clarity

    // Sync external value changes to internal state
    /* // Temporarily commented out for debugging deletion issue
    React.useEffect(() => {
        const dimensionSet = new Set(value ? value.split('\n').filter(d => d.trim()) : []);
        const newSelectedDevices = POPULAR_DEVICES?.filter((device: DeviceInfo) => dimensionSet.has(device.dimension)) || [];
        // Only update if the derived state differs from the current state to prevent potential loops
        if (JSON.stringify(newSelectedDevices) !== JSON.stringify(selectedDevices)) {
            setSelectedDevices(newSelectedDevices);
        }
    // Avoid including selectedDevices in dependency array if it causes loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);
    */

    // --- Initialize state from value prop ONCE on mount --- 
    React.useEffect(() => {
        // Fix: Properly split on newlines to handle different line break patterns
        const dimensionSet = new Set(value ? value.split(/\r?\n/).filter(d => d.trim()) : []);
        const initialSelectedDevices = POPULAR_DEVICES?.filter((device: DeviceInfo) => dimensionSet.has(device.dimension)) || [];
        setSelectedDevices(initialSelectedDevices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run only on mount

    const updateFormValue = (devices: DeviceInfo[]) => {
        // Fix: Use proper line separator that matches what the form parser expects
        // The form validation is looking for '\n' but we're potentially using OS-specific newlines
        const newValueString = devices.map(d => d.dimension).join('\n');
        onChange(newValueString);
    };

    const handleSelectDevice = React.useCallback((device: DeviceInfo) => {
        setInputValue('');
        if (!selectedDevices.some(selected => selected.dimension === device.dimension)) {
            const newSelected = [...selectedDevices, device];
            setSelectedDevices(newSelected);
            updateFormValue(newSelected);
        }
        // Do not close here, let blur handle it.
    }, [selectedDevices, onChange]); // Added onChange

    const handleRemoveDevice = React.useCallback((dimensionToRemove: string) => {
        // console.log("Attempting to remove:", dimensionToRemove);
        const newSelected = selectedDevices.filter(device => device.dimension !== dimensionToRemove);
        // console.log("Remaining devices:", newSelected.map(d => d.name));
        setSelectedDevices(newSelected);
        updateFormValue(newSelected);
        // Refocus the input after removing a chip might not be needed if Command handles focus well
        // inputRef.current?.focus();
    }, [selectedDevices, onChange]); // Added onChange

    const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        const input = inputRef.current;
        if (!input) return;

        // Backspace removes last chip if input is empty
        if (e.key === 'Backspace' && input.value === '' && selectedDevices.length > 0) {
            e.preventDefault();
            const lastDevice = selectedDevices[selectedDevices.length - 1];
            handleRemoveDevice(lastDevice.dimension);
        }

        // Escape closes dropdown, but doesn't blur input
        if (e.key === 'Escape') {
            e.preventDefault();
            setIsOpen(false);
        }
    }, [handleRemoveDevice, selectedDevices]);

    const availableDevices = POPULAR_DEVICES?.filter((device: DeviceInfo) =>
        !selectedDevices.some(selected => selected.dimension === device.dimension)
    ) || [];

    const filteredDevices = inputValue === ''
        ? availableDevices // Show all available if input is empty
        : availableDevices.filter(device =>
            device.name.toLowerCase().includes(inputValue.toLowerCase()) ||
            device.dimension.toLowerCase().includes(inputValue.toLowerCase())
          );

    // --- Add log to inspect filtered devices ---
    console.log('Filtered Devices:', JSON.stringify(filteredDevices.map(d => d.name)));

    return (
        <Command
            ref={commandRef} // Add ref to the outer Command
            onKeyDown={handleKeyDown} // Use the handler for the Command div
            className="overflow-visible bg-transparent"
        >
            {/* --- Input Area (Chips + Input) --- */}
            <div className={cn(
                "group flex h-28 w-full items-start rounded-md border border-input bg-transparent px-3 py-1 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                className // Allow external classes
            )}>
                <div className="flex flex-wrap gap-1 items-center">
                    {/* Render Selected Device Chips */}
                    {selectedDevices.map((device: DeviceInfo) => (
                        <Badge key={device.dimension} variant="secondary" className="whitespace-nowrap max-w-[200px]">
                            <span className="truncate" title={device.name}>{device.name}</span>
                            <span className="text-muted-foreground text-xs ml-1">({device.dimension})</span>
                            <button
                                type="button" // Prevent form submission
                                aria-label={`Remove ${device.name}`}
                                disabled={disabled}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleRemoveDevice(device.dimension); }}
                                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                onClick={() => handleRemoveDevice(device.dimension)}
                                className="ml-1 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
                            >
                                <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                            </button>
                        </Badge>
                    ))}

                    {/* --- Actual Input Field (within CommandPrimitive) --- */}
                    <CommandPrimitive.Input
                        ref={inputRef} // Use the internal ref here
                        id={id} // Pass id
                        value={inputValue}
                        onValueChange={setInputValue}
                        onBlur={(e) => {
                            setIsOpen(false); // Close on blur
                            if (onBlur) {
                                onBlur(e); // Forward the original event if needed
                            }
                        }}
                        onFocus={() => setIsOpen(true)} // Use the simpler focus handler
                        placeholder={selectedDevices.length === 0 ? placeholder : "Add another device..."} // Updated dynamic placeholder
                        disabled={disabled}
                        className="ml-2 flex-1 bg-transparent outline-none placeholder:text-muted-foreground text-sm py-1.5 text-white"
                    />
                </div>
            </div>

            {/* --- Command List Dropdown --- */}
            <div className="relative mt-2 z-50">
                {isOpen && (
                    <CommandList className="absolute top-0 w-full rounded-md border bg-popover text-popover-foreground shadow-md outline-none animate-in">
                        {filteredDevices.length > 0 ? (
                            <CommandGroup heading={`Suggestions (${filteredDevices.length})`}>
                                {filteredDevices.map((device: DeviceInfo) => (
                                    <CommandItem
                                        key={device.dimension}
                                        value={device.name} // Use name for cmdk value
                                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                        onSelect={() => handleSelectDevice(device)}
                                        className="cursor-pointer flex justify-between"
                                    >
                                        <span>{device.name}</span>
                                        <span className="text-muted-foreground text-xs">{device.dimension}</span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ) : ( 
                           /* Use CommandEmpty for better semantics */
                           inputValue && <CommandEmpty>No devices found matching "{inputValue}".</CommandEmpty>
                        )}
                         {/* Optionally, show message if input is empty but list is open */}
                        {!inputValue && filteredDevices.length === 0 && selectedDevices.length > 0 && (
                            <div className="p-2 text-xs text-center text-muted-foreground">
                                All available devices selected.
                            </div>
                        )}
                    </CommandList>
                )}
            </div>
        </Command>
    );
});

DeviceDimensionInput.displayName = 'DeviceDimensionInput'; 