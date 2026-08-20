import assert from "node:assert/strict";
import test from "node:test";
import { invalidateFrom } from "../src/lib/invalidation.ts";

test("design invalidation does not invalidate upstream artifacts", () => {
  assert.deepEqual(invalidateFrom("design"), {
    design_status: "stale",
    needs_rerun: 0,
  });
});

test("draft invalidation only invalidates draft and design", () => {
  assert.deepEqual(invalidateFrom("draft"), {
    draft_status: "stale",
    design_status: "stale",
    needs_rerun: 0,
  });
});

test("search invalidation invalidates the complete downstream chain", () => {
  assert.deepEqual(invalidateFrom("search"), {
    search_status: "stale",
    summary_status: "stale",
    draft_status: "stale",
    design_status: "stale",
    needs_rerun: 0,
  });
});
