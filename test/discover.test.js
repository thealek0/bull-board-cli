const { test } = require("node:test");
const assert = require("node:assert/strict");

const { escapeRegex, discoverQueues } = require("../src/discover");

/**
 * Minimal fake Redis whose SCAN walks a fixed key list one batch at a time,
 * exercising the cursor loop in discoverQueues.
 */
function fakeRedis(keys) {
  return {
    async scan(cursor, _match, _pattern, _count, size) {
      const start = Number(cursor);
      const batch = keys.slice(start, start + size);
      const next = start + size >= keys.length ? "0" : String(start + size);

      return [next, batch];
    },
  };
}

test("escapeRegex escapes regex metacharacters", () => {
  assert.equal(escapeRegex("a.b*c"), "a\\.b\\*c");
  assert.equal(escapeRegex("plain"), "plain");
});

test("discoverQueues extracts sorted, unique queue names", async () => {
  const redis = fakeRedis([
    "bull:emails:meta",
    "bull:notifications:meta",
    "bull:emails:meta",
    "bull:emails:id:123",
    "other:thing:meta",
  ]);

  const queues = await discoverQueues(redis, "bull");

  assert.deepEqual(queues, ["emails", "notifications"]);
});

test("discoverQueues handles queue names containing colons", async () => {
  const redis = fakeRedis(["bull:group:sub:meta"]);

  const queues = await discoverQueues(redis, "bull");

  assert.deepEqual(queues, ["group:sub"]);
});

test("discoverQueues respects a custom prefix", async () => {
  const redis = fakeRedis(["myapp:jobs:meta", "bull:jobs:meta"]);

  const queues = await discoverQueues(redis, "myapp");

  assert.deepEqual(queues, ["jobs"]);
});

test("discoverQueues paginates across SCAN batches", async () => {
  const keys = Array.from({ length: 450 }, (_, i) => `bull:q${i}:meta`);
  const redis = fakeRedis(keys);

  const queues = await discoverQueues(redis, "bull");

  assert.equal(queues.length, 450);
});
