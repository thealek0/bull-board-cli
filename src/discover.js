function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Escapes glob metacharacters so a prefix like `app*` or `bull[prod]` is matched
// literally by Redis SCAN MATCH, consistent with the literal extraction regex.
function escapeGlob(value) {
  return value.replace(/[*?[\]\\^]/g, "\\$&");
}

/**
 * Finds BullMQ queues by scanning Redis for their `:meta` keys.
 *
 * BullMQ stores one meta key per queue, e.g.:
 *   bull:emails:meta        -> queue "emails"
 *   myapp:notifications:meta -> queue "notifications"
 *
 * @param {import("ioredis").Redis} redis  Connected Redis client.
 * @param {string} [prefix="bull"]         BullMQ key prefix.
 * @returns {Promise<string[]>}            Sorted, de-duplicated queue names.
 */
async function discoverQueues(redis, prefix = "bull") {
  const queues = new Set();
  const regex = new RegExp(`^${escapeRegex(prefix)}:(.+):meta$`);
  const matchPattern = `${escapeGlob(prefix)}:*:meta`;

  let cursor = "0";

  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", matchPattern, "COUNT", 200);

    cursor = nextCursor;

    for (const key of keys) {
      const match = key.match(regex);

      if (match) {
        queues.add(match[1]);
      }
    }
  } while (cursor !== "0");

  return [...queues].sort();
}

module.exports = {
  escapeRegex,
  discoverQueues,
};
