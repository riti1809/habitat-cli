import test from "node:test";
import assert from "node:assert/strict";

import { resolveRegisteredAt } from "../src/registration-summary.ts";

test("resolveRegisteredAt falls back to a local timestamp when the remote response omits it", () => {
  assert.equal(
    resolveRegisteredAt(
      {
        registeredAt: undefined,
      },
      {
        registeredAt: "2026-07-10T16:06:11.967Z",
      },
    ),
    "2026-07-10T16:06:11.967Z",
  );
});
