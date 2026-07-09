declare module "bun:sqlite" {
  export class Database {
    constructor(
      filename?: string,
      options?: {
        create?: boolean;
        readwrite?: boolean;
        strict?: boolean;
        safeIntegers?: boolean;
      },
    );

    exec(sql: string): void;
    run(query: string, params?: unknown[] | Record<string, unknown>): unknown;
    query(sql: string): {
      get(params?: unknown[] | Record<string, unknown>): Record<string, unknown> | null;
      all(params?: unknown[] | Record<string, unknown>): Record<string, unknown>[];
    };
    transaction<TArgs extends unknown[]>(callback: (...args: TArgs) => void): (...args: TArgs) => void;
    close(): void;
  }
}
