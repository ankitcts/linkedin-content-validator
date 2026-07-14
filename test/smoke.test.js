import { test } from 'node:test';
import assert from 'node:assert/strict';

// Placeholder test so the CI pipeline exercises the test runner before the
// extension source lands. Replace/extend with real detector tests as the
// Stage-1 heuristics are implemented (see PROJECT_CONTEXT.md §4).
test('toolchain smoke test', () => {
  assert.equal(1 + 1, 2);
});
