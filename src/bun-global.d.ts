declare const Bun: {
  serve(options: {
    fetch: (request: Request, server: unknown) => Response | Promise<Response>;
    hostname?: string;
    port: number;
  }): unknown;
};
