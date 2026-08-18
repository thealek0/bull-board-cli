#!/usr/bin/env node

const { Command } = require("commander");

const config = require("./config");
const credentials = require("./credentials");
const { discoverQueues } = require("./discover");
const { createRedisClient } = require("./redis");
const { startServer } = require("./server");
const commands = require("./commands");
const ui = require("./ui");

const VERSION = require("../package.json").version;

// Dependency context injected into the (I/O-free) command layer. Tests build a
// fake context; here we wire the real modules.
const deps = {
  loadConfig: config.loadConfig,
  saveConfig: config.saveConfig,
  credentials,
  createRedisClient,
  discoverQueues,
  startServer,
};

let inquirerPrompt;

async function getPrompt() {
  if (!inquirerPrompt) {
    inquirerPrompt = (await import("inquirer")).default.prompt;
  }

  return inquirerPrompt;
}

async function selectProfile(profiles) {
  const prompt = await getPrompt();

  const { profile } = await prompt([
    {
      type: "select",
      name: "profile",
      message: "Select profile:",
      choices: profiles,
    },
  ]);

  return profile;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data.replace(/\r?\n$/, "")));
    process.stdin.on("error", reject);
  });
}

const toNumber = (value) => Number(value);

// Renders the running board's URL: a rounded box in a terminal, a plain line
// when piped/redirected so the output stays machine-friendly.
function renderBoard(url) {
  if (!ui.isInteractive()) {
    console.error(`Bull Board: ${url}`);

    return;
  }

  const boxed = ui
    .box([ui.pc.bold("Bull Board"), ui.pc.cyan(url)])
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

  console.error("");
  console.error(boxed);
  console.error(`  ${ui.pc.dim("Press Ctrl-C to stop")}`);
  console.error("");
}

const program = new Command();

program.name("bull-board-cli").description("Local BullMQ administration UI").version(VERSION);

program
  .command("add <name>")
  .description("Add or update a Redis connection profile")
  .option("--host <host>", "Redis host")
  .option("--port <port>", "Redis port", toNumber)
  .option("--db <db>", "Redis DB index", toNumber)
  .option("--username <username>", "Redis username")
  .option("--tls", "Connect to Redis over TLS")
  .option("--prefix <prefix>", "BullMQ key prefix")
  .option("--ui-port <port>", "UI port", toNumber)
  .option("--password-stdin", "Read the Redis password from stdin")
  .option("-y, --yes", "Non-interactive: use flags/defaults without prompting")
  .action(async (name, options) => {
    const nonInteractive = options.yes || options.passwordStdin;

    let input;

    if (nonInteractive) {
      input = {
        host: options.host ?? "127.0.0.1",
        port: options.port ?? 6379,
        db: options.db ?? 0,
        username: options.username,
        tls: options.tls || undefined,
        prefix: options.prefix ?? "bull",
        uiPort: options.uiPort ?? 3000,
      };
    } else {
      const prompt = await getPrompt();

      input = await prompt([
        {
          type: "input",
          name: "host",
          message: "Redis host:",
          default: options.host ?? "127.0.0.1",
        },
        { type: "number", name: "port", message: "Redis port:", default: options.port ?? 6379 },
        { type: "number", name: "db", message: "Redis DB:", default: options.db ?? 0 },
        {
          type: "input",
          name: "username",
          message: "Redis username (optional):",
          default: options.username,
        },
        { type: "confirm", name: "tls", message: "Use TLS?", default: options.tls ?? false },
        { type: "password", name: "password", message: "Redis password:" },
        {
          type: "input",
          name: "prefix",
          message: "BullMQ prefix:",
          default: options.prefix ?? "bull",
        },
        { type: "number", name: "uiPort", message: "UI port:", default: options.uiPort ?? 3000 },
      ]);
    }

    if (options.passwordStdin) {
      input.password = await readStdin();
    }

    const result = await commands.addProfile(deps, name, input);

    console.error(
      `${ui.symbols.ok} Profile ${ui.pc.bold(name)} ${result.created ? "saved" : "updated"}`,
    );
  });

program
  .command("profiles")
  .description("List profiles")
  .option("--json", "Output as JSON")
  .action((options) => {
    const profiles = commands.listProfiles(deps);

    if (options.json) {
      console.log(JSON.stringify(profiles));

      return;
    }

    if (profiles.length === 0) {
      console.log(ui.pc.dim("No profiles. Add one with: bull-board-cli add <name>"));

      return;
    }

    profiles.forEach(({ name, default: isDefault }) => {
      const marker = isDefault ? ui.pc.green("*") : " ";
      const label = isDefault ? ui.pc.bold(name) : name;
      const suffix = isDefault ? ui.pc.dim(" (default)") : "";

      console.log(`${marker} ${label}${suffix}`);
    });
  });

program
  .command("test <name>")
  .description("Test a Redis connection")
  .option("--json", "Output as JSON")
  .action(async (name, options) => {
    const result = await commands.testConnection(deps, name);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));

      return;
    }

    console.log("");
    console.log(
      ui.status(ui.symbols.ok, "Connected", result.version ? `Redis ${result.version}` : "Redis"),
    );
    console.log(ui.status(ui.symbols.ok, "Prefix   ", result.prefix));
    console.log(ui.status(ui.symbols.ok, "Queues   ", String(result.queues.length)));
    result.queues.forEach((queue) => console.log(`      ${ui.symbols.bullet} ${queue}`));
    console.log("");
  });

program
  .command("remove <name>")
  .description("Remove a profile")
  .action(async (name) => {
    await commands.removeProfile(deps, name);

    console.error(`Removed "${name}"`);
  });

// `start` is the default command (bare `bull-board-cli` runs it). Defining it as its
// own subcommand keeps its --host/--port/--prefix options scoped to it, so they
// don't collide with the same-named options on `add`.
program
  .command("start", { isDefault: true })
  .description("Start the Bull Board UI (default command)")
  .option("--profile <name>", "Profile name")
  .option("--prefix <prefix>", "Override BullMQ prefix")
  .option("--port <port>", "Override UI port", toNumber)
  .option("--host <host>", "Interface to bind the UI to (default 127.0.0.1)", "127.0.0.1")
  .option("--no-open", "Do not open the browser automatically")
  .action(async (options) => {
    const cfg = deps.loadConfig();

    const { name, profile } = await commands.resolveProfile(cfg, {
      selected: options.profile,
      prefix: options.prefix,
      port: options.port,
      pickProfile: selectProfile,
    });

    console.error("");
    console.error(`  ${ui.pc.bold("bull-board-cli")} ${ui.pc.dim("· profile:")} ${name}`);
    console.error("");

    let redis;
    let server;
    let url;

    const shutdown = async (code) => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }

      if (redis) {
        await redis.quit().catch(() => {});
      }

      process.exit(code);
    };

    // Registered before the (potentially slow) connect/startup work so Ctrl-C is
    // always graceful, not just once the server is listening.
    process.on("SIGINT", () => {
      console.error(`\n${ui.pc.dim("Shutting down…")}`);
      shutdown(0);
    });

    try {
      redis = await commands.connect(deps, name, profile);

      await redis.ping();
      console.error(
        ui.status(ui.symbols.ok, "Redis connected  ", `${profile.host}:${profile.port}`),
      );

      const queues = await deps.discoverQueues(redis, profile.prefix);
      console.error(
        ui.status(ui.symbols.ok, `${queues.length} queues discovered`, `prefix: ${profile.prefix}`),
      );

      if (queues.length > 0) {
        console.error(`      ${ui.pc.dim(queues.join("  "))}`);
      }

      if (options.host !== "127.0.0.1" && options.host !== "localhost") {
        console.error("");
        console.error(
          ui.status(
            ui.symbols.warn,
            ui.pc.yellow(`Binding to ${options.host}`),
            "unauthenticated UI — trusted networks only",
          ),
        );
      }

      ({ server, url } = await deps.startServer({
        redis,
        queues,
        prefix: profile.prefix,
        port: profile.uiPort,
        host: options.host,
        launchBrowser: options.open,
        title: name,
      }));

      renderBoard(url);
    } catch (err) {
      console.error("");
      console.error(ui.status(ui.symbols.err, ui.pc.red("Startup failed"), err.message));
      await shutdown(1);
    }
  });

// parseAsync so a rejection from any async command action (a UserError, or the
// keyring failing on a headless/locked keychain) surfaces as a clean message and
// a non-zero exit, not an unhandled promise rejection.
program.parseAsync().catch((err) => {
  console.error(`${ui.symbols.err} ${err.message}`);
  process.exit(1);
});
