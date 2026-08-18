const Redis = require("ioredis");

/**
 * Builds the static ioredis connection options for a profile.
 *
 * Kept pure (no retry closure, no event wiring) so the field mapping can be
 * unit-tested without opening a socket.
 *
 * @param {object} profile          Stored profile ({ host, port, db, username, tls }).
 * @param {string|null} [password]  Password resolved from the keychain.
 * @returns {import("ioredis").RedisOptions}
 */
function buildRedisOptions(profile, password) {
  return {
    host: profile.host,
    port: profile.port,
    db: profile.db,
    username: profile.username || undefined,
    password: password || undefined,
    // Enable TLS when the profile opts in, so credentials and job data are not
    // sent in cleartext to a remote Redis.
    tls: profile.tls ? {} : undefined,
    // BullMQ requires blocking commands, which ioredis rejects unless retries
    // per request are disabled.
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
  };
}

/**
 * Creates an ioredis client for a profile.
 *
 * Connection handling is deliberately two-phased:
 *   - Before the first successful connection it fails fast (gives up after
 *     `maxStartupRetries`) so `test` and startup don't hang against an
 *     unreachable server and pending commands reject.
 *   - After the first successful connection it reconnects indefinitely with
 *     capped backoff, so a long-running UI self-heals across transient Redis
 *     outages instead of dying permanently.
 *
 * Errors are swallowed until the first connection (they surface via command
 * rejections) and logged afterwards, so a mid-session Redis failure is visible
 * to the operator instead of silent.
 *
 * @param {object} profile                   Stored profile.
 * @param {string|null} [password]           Password resolved from the keychain.
 * @param {object} [opts]
 * @param {number} [opts.maxStartupRetries=3] Attempts before giving up on the
 *                                            initial connection.
 * @returns {import("ioredis").Redis}
 */
function createRedisClient(profile, password, { maxStartupRetries = 3 } = {}) {
  let connectedOnce = false;

  const redis = new Redis({
    ...buildRedisOptions(profile, password),
    retryStrategy(times) {
      if (!connectedOnce && times > maxStartupRetries) {
        return null;
      }

      return Math.min(times * 200, 2000);
    },
  });

  redis.once("ready", () => {
    connectedOnce = true;
  });

  redis.on("error", (err) => {
    // Startup errors reach the caller via the command rejection; only surface
    // failures that happen once the UI is already running.
    if (connectedOnce) {
      console.error(`Redis error: ${err.message}`);
    }
  });

  return redis;
}

module.exports = {
  buildRedisOptions,
  createRedisClient,
};
