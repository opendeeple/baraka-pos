declare function getLogPath(): string;
export declare const logger: {
    info: (msg: string, data?: unknown) => void;
    warn: (msg: string, data?: unknown) => void;
    error: (msg: string, err?: unknown) => void;
    close: () => void;
    getLogPath: typeof getLogPath;
};
export {};
