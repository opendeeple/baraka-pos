import Database from 'better-sqlite3';
export declare function initDatabase(training?: boolean): Promise<void>;
export declare function runMigrations(database: Database.Database): void;
export declare function getDb(): Database.Database;
/** Test seam: lets harnesses run the sync engine against an injected DB. */
export declare function setDbInstance(instance: Database.Database): void;
export declare function dbQuery(sql: string, params?: unknown[]): unknown[];
export declare function dbExec(sql: string, params?: unknown[]): void;
export declare function dbTransaction(ops: Array<{
    sql: string;
    params: unknown[];
}>): void;
