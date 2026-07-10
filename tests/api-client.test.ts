import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { ApiClientError, getApiBaseUrl, requestJson } from "../src/api-client.ts";

async function withServer(
  handler: Parameters<typeof createServer>[0],
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(handler);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not determine mock server address.");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

test("getApiBaseUrl uses HABITAT_API_BASE_URL when present", () => {
  const previous = process.env.HABITAT_API_BASE_URL;
  process.env.HABITAT_API_BASE_URL = "http://example.test:1234/";

  try {
    assert.equal(getApiBaseUrl(), "http://example.test:1234");
  } finally {
    if (previous === undefined) {
      delete process.env.HABITAT_API_BASE_URL;
    } else {
      process.env.HABITAT_API_BASE_URL = previous;
    }
  }
});

test("requestJson turns backend error responses into friendly CLI errors", async () => {
  await withServer((_request, response) => {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Registration missing." } }));
  }, async (baseUrl) => {
    await assert.rejects(
      requestJson("/registration", { baseUrl }),
      (error: unknown) => {
        assert.ok(error instanceof ApiClientError);
        assert.equal(error.message, "Registration missing.");
        assert.equal(error.status, 400);
        return true;
      },
    );
  });
});
