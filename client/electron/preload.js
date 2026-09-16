import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('electronAPI', {
    miniapp: {
        open: (id, url) => ipcRenderer.invoke('miniapp:open', { id, url }),
        hide: (id) => ipcRenderer.invoke('miniapp:hide', id),
        navigate: (action) => ipcRenderer.invoke('miniapp:navigate', action),
        destroy: (id) => ipcRenderer.invoke('miniapp:destroy', id),
        getActive: () => ipcRenderer.invoke('miniapp:getActive'),
        setBounds: (bounds) => ipcRenderer.invoke('miniapp:setBounds', bounds),
        onState: (cb) => {
            const listener = (_, s) => cb(s);
            ipcRenderer.on('miniapp:state', listener);
            return () => ipcRenderer.off('miniapp:state', listener);
        },
    },
    db: {
        query: (sql, params) => ipcRenderer.invoke('db:query', sql, params),
        exec: (sql, params) => ipcRenderer.invoke('db:exec', sql, params),
        transaction: (ops) => ipcRenderer.invoke('db:transaction', ops),
    },
    printer: {
        print: (receiptData) => ipcRenderer.invoke('printer:print', receiptData),
        openCashDrawer: () => ipcRenderer.invoke('printer:openCashDrawer'),
        testPrint: () => ipcRenderer.invoke('printer:testPrint'),
        listPrinters: () => ipcRenderer.invoke('printer:listPrinters'),
        configure: (config) => ipcRenderer.invoke('printer:configure', config),
    },
    session: {
        open: (openingBalance) => ipcRenderer.invoke('session:open', openingBalance),
        close: (closingData) => ipcRenderer.invoke('session:close', closingData),
        current: () => ipcRenderer.invoke('session:current'),
    },
    sync: {
        pushPending: () => ipcRenderer.invoke('sync:pushPending'),
        pullLatest: (table) => ipcRenderer.invoke('sync:pullLatest', table),
        getStatus: () => ipcRenderer.invoke('sync:getStatus'),
        ensureDevice: (jwtToken) => ipcRenderer.invoke('sync:ensureDevice', jwtToken),
        isDeviceRegistered: () => ipcRenderer.invoke('sync:isDeviceRegistered'),
        nextInvoiceNumber: () => ipcRenderer.invoke('sync:nextInvoiceNumber'),
        enqueue: (table, syncId, op) => ipcRenderer.invoke('sync:enqueue', table, syncId, op),
        retryDead: () => ipcRenderer.invoke('sync:retryDead'),
    },
    auth: {
        saveToken: (token) => ipcRenderer.invoke('auth:saveToken', token),
        getToken: () => ipcRenderer.invoke('auth:getToken'),
        clearToken: () => ipcRenderer.invoke('auth:clearToken'),
        login: (serverUrl, username, password) => ipcRenderer.invoke('auth:login', serverUrl, username, password),
        me: (serverUrl, token) => ipcRenderer.invoke('auth:me', serverUrl, token),
    },
    window: {
        openCustomerDisplay: () => ipcRenderer.invoke('window:openCustomerDisplay'),
        closeCustomerDisplay: () => ipcRenderer.invoke('window:closeCustomerDisplay'),
        updateCustomerDisplay: (data) => ipcRenderer.invoke('window:updateCustomerDisplay', data),
        openApp: (id, name, url) => ipcRenderer.invoke('window:openApp', { id, name, url }),
        toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
        isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
    },
    app: {
        isTraining: () => ipcRenderer.invoke('app:isTraining'),
        getVersion: () => ipcRenderer.invoke('app:getVersion'),
        getLogPath: () => ipcRenderer.invoke('app:getLogPath'),
        openLogs: () => ipcRenderer.invoke('app:openLogs'),
        reload: () => ipcRenderer.invoke('app:reload'),
    },
    reports: {
        fetch: (url, token) => ipcRenderer.invoke('reports:fetch', url, token),
    },
    updater: {
        check: () => ipcRenderer.invoke('updater:check'),
        download: () => ipcRenderer.invoke('updater:download'),
        install: () => ipcRenderer.invoke('updater:install'),
        onUpdateAvailable: (cb) => {
            ipcRenderer.on('updater:update-available', (_, info) => cb(info));
            return () => ipcRenderer.removeAllListeners('updater:update-available');
        },
        onDownloadProgress: (cb) => {
            ipcRenderer.on('updater:download-progress', (_, p) => cb(p));
            return () => ipcRenderer.removeAllListeners('updater:download-progress');
        },
        onUpdateDownloaded: (cb) => {
            ipcRenderer.on('updater:update-downloaded', (_, info) => cb(info));
            return () => ipcRenderer.removeAllListeners('updater:update-downloaded');
        },
    },
});
