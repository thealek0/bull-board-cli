const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildRedisOptions } = require("../src/redis");

test("buildRedisOptions maps profile fields", () => {
  const opts = buildRedisOptions(
    { host: "localhost", port: 6380, db: 2, username: "acl" },
    "secret",
  );

  assert.equal(opts.host, "localhost");
  assert.equal(opts.port, 6380);
  assert.equal(opts.db, 2);
  assert.equal(opts.username, "acl");
  assert.equal(opts.password, "secret");
  assert.equal(opts.maxRetriesPerRequest, null);
});

test("buildRedisOptions omits empty username and password", () => {
  const opts = buildRedisOptions({ host: "h", port: 6379, db: 0 }, null);

  assert.equal(opts.username, undefined);
  assert.equal(opts.password, undefined);
});

test("buildRedisOptions enables TLS only when the profile opts in", () => {
  const off = buildRedisOptions({ host: "h", port: 6379, db: 0 }, null);
  assert.equal(off.tls, undefined);

  const on = buildRedisOptions({ host: "h", port: 6379, db: 0, tls: true }, null);
  assert.deepEqual(on.tls, {});
});
