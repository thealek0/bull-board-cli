const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let tmpHome;
let originalHome;
let originalAppData;
let config;

before(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bull-board-cli-test-"));
  originalHome = process.env.HOME;
  originalAppData = process.env.APPDATA;
  process.env.HOME = tmpHome;
  process.env.APPDATA = tmpHome;
  config = require("../src/config");
});

after(() => {
  process.env.HOME = originalHome;
  process.env.APPDATA = originalAppData;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test("loadConfig returns an empty config when no file exists", () => {
  assert.deepEqual(config.loadConfig(), { profiles: {}, default: null });
});

test("saveConfig then loadConfig round-trips validated data", () => {
  const data = {
    profiles: { local: { host: "127.0.0.1", port: 6379, db: 0, prefix: "bull", uiPort: 3000 } },
    default: "local",
  };

  config.saveConfig(data);

  assert.deepEqual(config.loadConfig(), data);
});

test("saveConfig writes atomically (no leftover temp file)", () => {
  config.saveConfig({ profiles: {}, default: null });

  const dir = path.dirname(config.getConfigFile());
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes(".tmp"));

  assert.deepEqual(leftovers, []);
});

test("saveConfig restricts file permissions to the owner on posix", (t) => {
  if (process.platform === "win32") {
    t.skip("permissions are not enforced on win32");

    return;
  }

  config.saveConfig({ profiles: {}, default: null });

  const mode = fs.statSync(config.getConfigFile()).mode & 0o777;

  assert.equal(mode, 0o600);
});

test("loadConfig rejects a profile with a wrong field type", () => {
  const file = config.getConfigFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      profiles: { bad: { host: "h", port: "not-a-number", db: 0, prefix: "bull", uiPort: 3000 } },
      default: "bad",
    }),
  );

  assert.throws(() => config.loadConfig(), /Invalid profile "bad".*port must be an integer/s);
});

test("validateConfig resets a default that points to a missing profile", () => {
  const result = config.validateConfig({ profiles: {}, default: "ghost" });

  assert.equal(result.default, null);
});

test("normalizeProfile coerces string numbers and drops empty optionals", () => {
  const profile = config.normalizeProfile(
    { host: "h", port: "6380", db: "1", username: "", prefix: "bull", uiPort: "4000" },
    { coerce: true },
  );

  assert.equal(profile.port, 6380);
  assert.equal(profile.db, 1);
  assert.equal(profile.uiPort, 4000);
  assert.equal("username" in profile, false);
});

test("normalizeProfile rejects out-of-range ports", () => {
  assert.throws(
    () =>
      config.normalizeProfile(
        { host: "h", port: 99999, db: 0, prefix: "bull", uiPort: 3000 },
        { coerce: true },
      ),
    /port must be between/,
  );
});
