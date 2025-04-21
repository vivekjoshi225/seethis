// constants/devices.ts
export interface DeviceInfo {
    name: string;
    dimension: string; // WxH format
}

export const POPULAR_DEVICES: DeviceInfo[] = [
    // Phones
    { name: 'iPhone SE', dimension: '375x667' },
    { name: 'iPhone 12 / 13 / 14', dimension: '390x844' },
    { name: 'iPhone 13 Mini', dimension: '375x812' },
    { name: 'iPhone 14 Pro / 15 Pro', dimension: '393x852' },
    { name: 'iPhone 14 Pro Max / 15 Pro Max', dimension: '430x932' },
    { name: 'Samsung Galaxy S22 / S23', dimension: '360x780' },
    { name: 'Samsung Galaxy S22 / S23 Ultra', dimension: '384x854' },
    { name: 'Samsung Galaxy Z Fold (Unfolded)', dimension: '673x841' },
    { name: 'Google Pixel 6', dimension: '412x915' },
    { name: 'Google Pixel 7 Pro', dimension: '412x892' },

    // Tablets
    { name: 'iPad (10th Gen)', dimension: '820x1180' },
    { name: 'iPad Mini 6', dimension: '744x1133' },
    { name: 'iPad Air (5th Gen)', dimension: '820x1180' },
    { name: 'iPad Pro 11"', dimension: '834x1194' },
    { name: 'iPad Pro 12.9"', dimension: '1024x1366' },

    // Laptops / Desktops
    { name: 'MacBook Air 13" (M1)', dimension: '1440x900' },
    { name: 'MacBook Air 13" (M2/M3)', dimension: '1470x956' },
    { name: 'MacBook Pro 13"', dimension: '1440x900' },
    { name: 'MacBook Pro 14"', dimension: '1512x982' },
    { name: 'MacBook Pro 16"', dimension: '1728x1117' },
    { name: 'Surface Laptop Studio', dimension: '1600x1067' },
    { name: 'Dell XPS 13', dimension: '1920x1200' },
    { name: 'Generic Laptop (HD)', dimension: '1366x768' },
    { name: 'Generic Laptop (FHD)', dimension: '1920x1080' },
    { name: 'Generic Desktop (QHD)', dimension: '2560x1440' },
    { name: 'Generic Desktop (4K)', dimension: '3840x2160' },
    { name: 'Common Mobile Small (Approx)', dimension: '360x640' },
    { name: 'Common Mobile Medium (Approx)', dimension: '375x812' },
    { name: 'Common Mobile Large (Approx)', dimension: '414x896' },
    { name: 'Common Tablet (Portrait)', dimension: '768x1024' },
];

// Optional: Map for quick lookup if needed, though filtering the array might be sufficient
export const DEVICE_DIMENSIONS_MAP: Record<string, string> = POPULAR_DEVICES.reduce((acc, device) => {
    acc[device.name] = device.dimension;
    return acc;
}, {} as Record<string, string>); 