const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { Queue } = require("bullmq");
const commands = require("../src/commands");
const { createRedisClient } = require("../src/redis");
const { discoverQueues } = require("../src/discover");

// Real Redis, driven through the command layer end-to-end. Skips itself when no
// Redis is reachable (e.g. CI without a redis service), so it never fails the
// build — set REDIS_HOST/REDIS_PORT to point elsewhere.
const HOST = process.env.REDIS_HOST || "127.0.0.1";
const PORT = Number(process.env.REDIS_PORT || 6379);
const PREFIX = "bull-board-cli-it";
const QUEUE = "it-queue";

let reachable = false;
let seedQueue;

async function isReachable() {
  const redis = createRedisClient({ host: HOST, port: PORT, db: 0 }, null, {
    maxStartupRetries: 1,
  });

  try {
    await redis.ping();

    return true;
  } catch {
    return false;
  } finally {
    await redis.quit().catch(() => {});
  }
}

before(async () => {
  reachable = await isReachable();

  if (!reachable) {
    return;
  }

  seedQueue = new Queue(QUEUE, {
    connection: { host: HOST, port: PORT, maxRetriesPerRequest: null },
    prefix: PREFIX,
  });
  await seedQueue.add("job", { hello: "world" });
});

after(async () => {
  if (seedQueue) {
    await seedQueue.obliterate({ force: true });
    await seedQueue.close();
  }
});

function realDeps() {
  return {
    loadConfig: () => ({
      profiles: { it: { host: HOST, port: PORT, db: 0, prefix: PREFIX, uiPort: 3000 } },
      default: "it",
    }),
    saveConfig: () => {},
    credentials: {
      getPassword: async () => null,
      savePassword: async () => {},
      deletePassword: async () => {},
    },
    createRedisClient,
    discoverQueues,
    startServer: async () => {
      throw new Error("not used");
    },
  };
}

test("testConnection discovers a seeded queue against real Redis", async (t) => {
  if (!reachable) {
    t.skip(`no Redis at ${HOST}:${PORT}`);

    return;
  }

  const result = await commands.testConnection(realDeps(), "it");

  assert.equal(result.connected, true);
  assert.match(result.version, /^\d+\.\d+/);
  assert.ok(result.queues.includes(QUEUE), `expected ${QUEUE} in ${result.queues}`);
});
