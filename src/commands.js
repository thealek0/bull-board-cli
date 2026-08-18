const { normalizeProfile } = require("./config");

// Names that alias Object.prototype keys would corrupt the profiles map
// (prototype pollution) instead of storing a real profile.
const RESERVED_NAMES = new Set(["__proto__", "prototype", "constructor"]);

class UserError extends Error {}

function assertSafeProfileName(name) {
  if (RESERVED_NAMES.has(name)) {
    throw new UserError(`Invalid profile name: "${name}" is reserved`);
  }
}

/**
 * All commands take a `deps` context so they can be unit-tested with in-memory
 * fakes instead of a real keychain, Redis, or filesystem. `deps`:
 *   { loadConfig, saveConfig, credentials, createRedisClient, discoverQueues,
 *     startServer }
 * where `credentials` = { savePassword, getPassword, deletePassword }.
 */

async function connect(deps, profileName, profile) {
  const password = await deps.credentials.getPassword(profileName);

  return deps.createRedisClient(profile, password);
}

async function withConnection(deps, profileName, profile, fn) {
  const redis = await connect(deps, profileName, profile);

  try {
    return await fn(redis);
  } finally {
    await redis.quit().catch(() => {});
  }
}

async function addProfile(deps, name, input) {
  assertSafeProfileName(name);

  let profile;

  try {
    profile = normalizeProfile(input, { coerce: true });
  } catch (err) {
    throw new UserError(`Invalid profile: ${err.message}`);
  }

  const config = deps.loadConfig();
  const isNew = !Object.prototype.hasOwnProperty.call(config.profiles, name);

  config.profiles[name] = profile;

  if (!config.default) {
    config.default = name;
  }

  deps.saveConfig(config);
  await deps.credentials.savePassword(name, input.password || "");

  return { name, created: isNew };
}

function listProfiles(deps) {
  const config = deps.loadConfig();

  return Object.keys(config.profiles).map((name) => ({
    name,
    default: config.default === name,
  }));
}

async function removeProfile(deps, name) {
  assertSafeProfileName(name);

  const config = deps.loadConfig();

  if (!Object.prototype.hasOwnProperty.call(config.profiles, name)) {
    throw new UserError(`Profile "${name}" not found`);
  }

  delete config.profiles[name];

  if (config.default === name) {
    config.default = null;
  }

  deps.saveConfig(config);
  await deps.credentials.deletePassword(name);

  return { name };
}

function getProfileOrThrow(config, name) {
  if (!Object.prototype.hasOwnProperty.call(config.profiles, name)) {
    throw new UserError(`Profile "${name}" not found`);
  }

  return config.profiles[name];
}

async function testConnection(deps, name) {
  assertSafeProfileName(name);

  const config = deps.loadConfig();
  const profile = getProfileOrThrow(config, name);

  return withConnection(deps, name, profile, async (redis) => {
    await redis.ping();

    const info = await redis.info("server");
    const versionMatch = info.match(/redis_version:([^\r\n]+)/);
    const queues = await deps.discoverQueues(redis, profile.prefix);

    return {
      connected: true,
      version: versionMatch ? versionMatch[1] : null,
      prefix: profile.prefix,
      queues,
    };
  });
}

/**
 * Resolves which profile to use for the long-running UI, applying CLI overrides.
 *
 * @param {object} config             Loaded config.
 * @param {object} opts
 * @param {string} [opts.selected]    Explicit --profile.
 * @param {string} [opts.prefix]      Override prefix.
 * @param {number} [opts.port]        Override UI port (0 is valid).
 * @param {function} [opts.pickProfile] async (names) => name, for interactive choice.
 * @returns {Promise<{ name: string, profile: object }>}
 */
async function resolveProfile(config, opts = {}) {
  const names = Object.keys(config.profiles);

  let name = opts.selected;

  if (name) {
    getProfileOrThrow(config, name);
  } else if (names.length === 0) {
    throw new UserError("No profiles configured. Run: bull-board-cli add <name>");
  } else if (config.default && config.profiles[config.default]) {
    name = config.default;
  } else if (names.length === 1) {
    name = names[0];
  } else if (opts.pickProfile) {
    name = await opts.pickProfile(names);
  } else {
    throw new UserError("Multiple profiles configured; pass --profile <name>");
  }

  const profile = {
    ...config.profiles[name],
    ...(opts.prefix ? { prefix: opts.prefix } : {}),
    // Compare against undefined so an explicit --port 0 (ephemeral) is honoured.
    ...(opts.port !== undefined ? { uiPort: opts.port } : {}),
  };

  return { name, profile };
}

module.exports = {
  UserError,
  assertSafeProfileName,
  connect,
  withConnection,
  addProfile,
  listProfiles,
  removeProfile,
  testConnection,
  resolveProfile,
};
