import assert from "node:assert/strict";
import test from "node:test";
import { inspectTurn, installContinueRetry, shouldAutoRetry } from "../lib/continue-retry.js";

test("a provider refusal does not request a retry or enqueue a follow-up turn", async () => {
  const handlers = new Map();
  const plugin = installContinueRetry({ on(event, handler) { handlers.set(event, handler); } });
  const failure = { code: "CONTENT_REFUSED" };
  try {
    const result = await handlers.get("agent/request-error")({ agent: { id: "test" }, failure });
    assert.equal(result, undefined);
    const reason = { kind: "error", error: failure };
    const turn = inspectTurn([{ type: "turn/end", seq: 1, data: { turn: 1, reason } }]);
    assert.equal(turn.auto, false);
    assert.equal(turn.reason.error.code, "CONTENT_REFUSED");
  } finally {
    plugin.dispose();
  }
});

test("a transport interruption can still be retried", () => {
  assert.equal(shouldAutoRetry({ code: "TRANSPORT" }), true);
});
