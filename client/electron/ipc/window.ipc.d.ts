import { BrowserWindow } from 'electron';
export declare function hideAllMiniapps(): void;
export declare function registerFullscreenIpc(getMainWindow: () => BrowserWindow | null): void;
export declare function registerWindowIpc(createCustomerWindow: () => BrowserWindow, getCustomerWindow: () => BrowserWindow | null): void;
