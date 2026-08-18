const fs = require("fs");
const path = require("path");
const os = require("os");

// Field specification for a connection profile. Drives both coercion of raw
// CLI/prompt input and strict validation of an on-disk config.
const PROFILE_FIELDS = {
  host: { type: "string", required: true },
  port: { type: "int", min: 1, max: 65535, required: true },
  db: { type: "int", min: 0, max: 255, required: true },
  username: { type: "string", required: false },
  tls: { type: "boolean", required: false },
  prefix: { type: "string", required: true },
  uiPort: { type: "int", min: 0, max: 65535, required: true },
};

function getConfigDir() {
  if (process.platform === "win32") {
    const base = process.env.APPDATA || os.homedir();

    return path.join(base, "bull-board-cli");
  }

  return path.join(os.homedir(), ".config", "bull-board-cli");
}

function getConfigFile() {
  return path.join(getConfigDir(), "config.json");
}

/**
 * Validates (and optionally coerces) a single profile against PROFILE_FIELDS.
 *
 * @param {object} input             Raw profile object.
 * @param {object} [opts]
 * @param {boolean} [opts.coerce]    Coerce string numbers/booleans (for CLI input).
 * @returns {object}                 Normalized profile with only known fields.
 * @throws {Error}                   On the first structural problem.
 */
function normalizeProfile(input, { coerce = false } = {}) {
  if (!input || typeof input !== "object") {
    throw new Error("profile must be an object");
  }

  const out = {};
  const errors = [];

  for (const [key, spec] of Object.entries(PROFILE_FIELDS)) {
    let value = input[key];

    if (value === undefined || value === null || value === "") {
      if (spec.required) {
        errors.push(`${key} is required`);
      }

      continue;
    }

    if (spec.type === "int") {
      const num = coerce ? Number(value) : value;

      if (typeof num !== "number" || !Number.isInteger(num)) {
        errors.push(`${key} must be an integer`);
        continue;
      }

      if (num < spec.min || num > spec.max) {
        errors.push(`${key} must be between ${spec.min} and ${spec.max}`);
        continue;
      }

      out[key] = num;
    } else if (spec.type === "string") {
      if (typeof value !== "string" && !coerce) {
        errors.push(`${key} must be a string`);
        continue;
      }

      out[key] = String(value);
    } else if (spec.type === "boolean") {
      if (typeof value !== "boolean" && !coerce) {
        errors.push(`${key} must be a boolean`);
        continue;
      }

      out[key] = Boolean(value);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return out;
}

/**
 * Validates a raw parsed config, returning a normalized { profiles, default }.
 * Unknown top-level keys and per-profile fields are dropped. A default pointing
 * at a missing profile is reset to null rather than treated as fatal.
 */
function validateConfig(raw, source = "config") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Config at ${source} must be a JSON object`);
  }

  const rawProfiles =
    raw.profiles && typeof raw.profiles === "object" && !Array.isArray(raw.profiles)
      ? raw.profiles
      : {};

  const profiles = {};

  for (const [name, profile] of Object.entries(rawProfiles)) {
    try {
      profiles[name] = normalizeProfile(profile, { coerce: false });
    } catch (err) {
      throw new Error(`Invalid profile "${name}" in ${source}: ${err.message}`);
    }
  }

  const requested = typeof raw.default === "string" ? raw.default : null;

  return {
    profiles,
    default: requested && profiles[requested] ? requested : null,
  };
}

function loadConfig() {
  const file = getConfigFile();

  if (!fs.existsSync(file)) {
    return { profiles: {}, default: null };
  }

  let raw;

  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Config file at ${file} is not valid JSON: ${err.message}`);
  }

  return validateConfig(raw, file);
}

function saveConfig(config) {
  fs.mkdirSync(getConfigDir(), { recursive: true });

  const file = getConfigFile();
  const tmp = `${file}.${process.pid}.tmp`;

  // Write to a temp file then rename: rename is atomic on the same filesystem,
  // so a crash or concurrent reader never sees a half-written config.
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });

  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }

  if (process.platform !== "win32") {
    fs.chmodSync(file, 0o600);
  }
}

module.exports = {
  PROFILE_FIELDS,
  getConfigFile,
  normalizeProfile,
  validateConfig,
  loadConfig,
  saveConfig,
};
