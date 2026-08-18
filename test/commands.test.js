const { test } = require("node:test");
const assert = require("node:assert/strict");

const commands = require("../src/commands");

// Builds an in-memory dependency context: fake config store, keychain, and Redis.
function makeDeps(overrides = {}) {
  let store = { profiles: {}, default: null };
  const passwords = new Map();

  const redis = {
    pinged: false,
    quit_called: false,
    ping: async () => {
      redis.pinged = true;

      return "PONG";
    },
    info: async () => "# Server\r\nredis_version:7.4.1\r\n",
    quit: async () => {
      redis.quit_called = true;
    },
  };

  const deps = {
    _redis: redis,
    _passwords: passwords,
    _store: () => store,
    loadConfig: () => structuredClone(store),
    saveConfig: (next) => {
      store = structuredClone(next);
    },
    credentials: {
      savePassword: async (name, password) => {
        passwords.set(name, password);
      },
      getPassword: async (name) => (passwords.has(name) ? passwords.get(name) : null),
      deletePassword: async (name) => passwords.delete(name),
    },
    createRedisClient: () => redis,
    discoverQueues: async () => ["emails", "reports"],
    startServer: async () => ({ server: {}, url: "http://127.0.0.1:3000/queues" }),
    ...overrides,
  };

  return deps;
}

const validInput = {
  host: "127.0.0.1",
  port: 6379,
  db: 0,
  prefix: "bull",
  uiPort: 3000,
  password: "s3cr3t",
};

test("addProfile creates a profile, sets it default, and stores the password", async () => {
  const deps = makeDeps();

  const result = await commands.addProfile(deps, "local", validInput);

  assert.deepEqual(result, { name: "local", created: true });
  assert.equal(deps._store().default, "local");
  assert.equal(deps._store().profiles.local.host, "127.0.0.1");
  assert.equal(deps._passwords.get("local"), "s3cr3t");
});

test("addProfile coerces string numeric input", async () => {
  const deps = makeDeps();

  await commands.addProfile(deps, "local", { ...validInput, port: "6380", db: "2" });

  assert.equal(deps._store().profiles.local.port, 6380);
  assert.equal(deps._store().profiles.local.db, 2);
});

test("addProfile updating an existing profile keeps the existing default", async () => {
  const deps = makeDeps();

  await commands.addProfile(deps, "a", validInput);
  await commands.addProfile(deps, "b", validInput);
  const result = await commands.addProfile(deps, "b", { ...validInput, host: "10.0.0.1" });

  assert.deepEqual(result, { name: "b", created: false });
  assert.equal(deps._store().default, "a");
  assert.equal(deps._store().profiles.b.host, "10.0.0.1");
});

test("addProfile rejects reserved names (prototype pollution)", async () => {
  const deps = makeDeps();

  await assert.rejects(
    () => commands.addProfile(deps, "__proto__", validInput),
    (err) => err instanceof commands.UserError && /reserved/.test(err.message),
  );
});

test("addProfile rejects invalid input", async () => {
  const deps = makeDeps();

  await assert.rejects(
    () => commands.addProfile(deps, "local", { ...validInput, port: 0 }),
    (err) => err instanceof commands.UserError,
  );
});

test("listProfiles marks the default", async () => {
  const deps = makeDeps();
  await commands.addProfile(deps, "a", validInput);
  await commands.addProfile(deps, "b", validInput);

  assert.deepEqual(commands.listProfiles(deps), [
    { name: "a", default: true },
    { name: "b", default: false },
  ]);
});

test("removeProfile deletes the profile, clears default, and drops the password", async () => {
  const deps = makeDeps();
  await commands.addProfile(deps, "a", validInput);

  await commands.removeProfile(deps, "a");

  assert.deepEqual(deps._store().profiles, {});
  assert.equal(deps._store().default, null);
  assert.equal(deps._passwords.has("a"), false);
});

test("removeProfile throws on a missing profile", async () => {
  const deps = makeDeps();

  await assert.rejects(
    () => commands.removeProfile(deps, "ghost"),
    (err) => err instanceof commands.UserError && /not found/.test(err.message),
  );
});

test("testConnection returns version, prefix, and queues and always quits", async () => {
  const deps = makeDeps();
  await commands.addProfile(deps, "local", validInput);

  const result = await commands.testConnection(deps, "local");

  assert.equal(result.connected, true);
  assert.equal(result.version, "7.4.1");
  assert.equal(result.prefix, "bull");
  assert.deepEqual(result.queues, ["emails", "reports"]);
  assert.equal(deps._redis.quit_called, true);
});

test("testConnection quits the connection even when a command throws", async () => {
  const deps = makeDeps({
    discoverQueues: async () => {
      throw new Error("boom");
    },
  });
  await commands.addProfile(deps, "local", validInput);

  await assert.rejects(() => commands.testConnection(deps, "local"), /boom/);
  assert.equal(deps._redis.quit_called, true);
});

test("resolveProfile honours an explicit selection", async () => {
  const config = {
    profiles: { a: { prefix: "bull", uiPort: 3000 }, b: { prefix: "x", uiPort: 1 } },
    default: "a",
  };

  const { name } = await commands.resolveProfile(config, { selected: "b" });

  assert.equal(name, "b");
});

test("resolveProfile falls back to the default, then the sole profile", async () => {
  const withDefault = {
    profiles: { a: { prefix: "bull", uiPort: 3000 }, b: { prefix: "x", uiPort: 1 } },
    default: "b",
  };
  assert.equal((await commands.resolveProfile(withDefault, {})).name, "b");

  const single = { profiles: { only: { prefix: "bull", uiPort: 3000 } }, default: null };
  assert.equal((await commands.resolveProfile(single, {})).name, "only");
});

test("resolveProfile prompts when multiple profiles and no default", async () => {
  const config = {
    profiles: { a: { prefix: "bull", uiPort: 3000 }, b: { prefix: "x", uiPort: 1 } },
    default: null,
  };

  const { name } = await commands.resolveProfile(config, {
    pickProfile: async (names) => names[1],
  });

  assert.equal(name, "b");
});

test("resolveProfile applies prefix and port overrides, honouring port 0", async () => {
  const config = { profiles: { a: { prefix: "bull", uiPort: 3000 } }, default: "a" };

  const { profile } = await commands.resolveProfile(config, {
    selected: "a",
    prefix: "custom",
    port: 0,
  });

  assert.equal(profile.prefix, "custom");
  assert.equal(profile.uiPort, 0);
});

test("resolveProfile throws when no profiles exist", async () => {
  await assert.rejects(
    () => commands.resolveProfile({ profiles: {}, default: null }, {}),
    (err) => err instanceof commands.UserError && /No profiles/.test(err.message),
  );
});
