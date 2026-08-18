# bull-board-cli

A small local CLI that discovers [BullMQ](https://docs.bullmq.io/) queues in a
Redis instance and serves a [Bull Board](https://github.com/felixmosh/bull-board)
web UI for inspecting them.

Connection profiles are stored in a per-user config file; passwords are kept in
the OS keychain (via [@napi-rs/keyring](https://github.com/napi-rs/keyring)),
never on disk.

## Install

Run it without installing anything:

```bash
npx bull-board-cli add local
npx bull-board-cli
```

Or install globally to get the `bull-board-cli` command on your `PATH`:

```bash
npm install -g bull-board-cli
```

From source (for development):

```bash
git clone <your-repo-url> && cd bull-board-cli
npm install
npm link   # optional: exposes the `bull-board-cli` command globally
```

## Usage

```bash
# Add a connection profile interactively
bull-board-cli add local

# Add a profile non-interactively (for scripts / dotfiles / CI)
bull-board-cli add ci --yes --host 127.0.0.1 --port 6379 --prefix bull
echo "$REDIS_PASSWORD" | bull-board-cli add ci --yes --host redis.internal --password-stdin

# List saved profiles (the default is marked with *); --json for machine output
bull-board-cli profiles
bull-board-cli profiles --json

# Verify a profile can connect and list its queues
bull-board-cli test local
bull-board-cli test local --json

# Remove a profile (also deletes its keychain password)
bull-board-cli remove local

# Start the UI (uses the default profile, or the only one, or prompts to choose)
bull-board-cli                    # equivalent to: bull-board-cli start
bull-board-cli --profile local
bull-board-cli --prefix myapp --port 4000
bull-board-cli --no-open          # don't open a browser automatically
bull-board-cli --host 0.0.0.0     # expose beyond loopback (see Security)
```

Machine-readable output (`--json`) and status/log lines are kept separate: data
goes to stdout, diagnostics to stderr, so `bull-board-cli test x --json` pipes cleanly.

The UI is served at `http://127.0.0.1:<uiPort>/queues`. Press `Ctrl-C` to shut
it down cleanly.

## Configuration

| Field      | Description                               | Default     |
| ---------- | ----------------------------------------- | ----------- |
| `host`     | Redis host                                | `127.0.0.1` |
| `port`     | Redis port                                | `6379`      |
| `db`       | Redis database index                      | `0`         |
| `username` | Redis ACL username (optional)             | –           |
| `tls`      | Connect to Redis over TLS                 | `false`     |
| `prefix`   | BullMQ key prefix used to discover queues | `bull`      |
| `uiPort`   | Port the Bull Board UI listens on         | `3000`      |

Config location:

- macOS / Linux: `~/.config/bull-board-cli/config.json` (mode `0600`)
- Windows: `%APPDATA%\bull-board-cli\config.json`

## Security

- **The Bull Board UI is unauthenticated and can mutate queues** (retry, remove,
  drain, and it displays job payloads). By default it binds to `127.0.0.1` only,
  so it is not reachable from the network. `--host 0.0.0.0` opts out and prints a
  warning — only use it on a trusted network, ideally behind a reverse proxy that
  adds authentication.
- Redis passwords are stored in the OS keychain (@napi-rs/keyring), never in the
  config file. The config file itself is written with mode `0600`.
- Set `tls: true` on a profile when connecting to a remote Redis so credentials
  and job data are encrypted in transit.

## Development

```bash
npm test            # node:test suite; the real-Redis test self-skips if none is reachable
npm run test:coverage
npm run lint        # eslint
npm run format      # prettier --write
```

The code is split into an I/O-free command layer (`src/commands.js`) driven by an
injected dependency context, and a thin CLI adapter (`src/cli.js`) that wires the
real config, keychain, Redis, and server. This keeps the business logic unit-testable
without a real keychain or Redis.

## How queue discovery works

BullMQ stores one `:meta` key per queue. The CLI runs a non-blocking `SCAN` for
`<prefix>:*:meta` keys and extracts the queue name from each match, so no queue
registry needs to be maintained separately.

## Credits

Built on [Bull Board](https://github.com/felixmosh/bull-board) (MIT) and
[BullMQ](https://github.com/taskforcesh/bullmq) (MIT). This is an unofficial
community tool, not affiliated with or endorsed by their authors.

## License

[MIT](LICENSE) © alexander.s
