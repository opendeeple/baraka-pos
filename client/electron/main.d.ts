import { BrowserWindow } from 'electron';
declare const isTraining: boolean;
declare let mainWindow: BrowserWindow | null;
declare let customerWindow: BrowserWindow | null;
export declare function createCustomerWindow(): BrowserWindow;
export { mainWindow, customerWindow, isTraining };
