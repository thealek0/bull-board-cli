const express = require("express");
const { Queue } = require("bullmq");
const { createBullBoard } = require("@bull-board/api");
const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");
const { ExpressAdapter } = require("@bull-board/express");

const BASE_PATH = "/queues";

let openModule;

async function openBrowser(url) {
  if (!openModule) {
    openModule = (await import("open")).default;
  }

  return openModule(url);
}

/**
 * Starts the Bull Board UI for the given queues.
 *
 * @param {object}   opts
 * @param {import("ioredis").Redis} opts.redis  Shared Redis connection.
 * @param {string[]} opts.queues                Queue names to mount.
 * @param {string}   [opts.prefix="bull"]       BullMQ key prefix.
 * @param {number}   [opts.port=3000]           UI port.
 * @param {string}   [opts.host="127.0.0.1"]    Interface to bind. Defaults to
 *                                              loopback so the unauthenticated
 *                                              board is not exposed to the network.
 * @param {boolean}  [opts.launchBrowser=true]  Open the UI in a browser.
 * @param {string}   [opts.title]               Board title.
 * @returns {Promise<{ server: import("http").Server, url: string }>}
 */
async function startServer({
  redis,
  queues,
  prefix = "bull",
  port = 3000,
  host = "127.0.0.1",
  launchBrowser = true,
  title,
}) {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BASE_PATH);

  const bullQueues = queues.map(
    (queueName) => new BullMQAdapter(new Queue(queueName, { connection: redis, prefix })),
  );

  createBullBoard({
    queues: bullQueues,
    serverAdapter,
    options: {
      uiConfig: title ? { boardTitle: title } : {},
    },
  });

  const app = express();
  app.use(BASE_PATH, serverAdapter.getRouter());

  return new Promise((resolve, reject) => {
    // Bind to the given host (loopback by default). The board is unauthenticated
    // and can mutate queues, so it must not be reachable from the network unless
    // the operator explicitly opts in.
    const server = app.listen(port, host, async () => {
      // Use the bound port, not the requested one, so an ephemeral port
      // (port 0) yields the real URL. Rendering is left to the caller.
      const displayHost = host === "0.0.0.0" ? "localhost" : host;
      const url = `http://${displayHost}:${server.address().port}${BASE_PATH}`;

      if (launchBrowser) {
        try {
          await openBrowser(url);
        } catch {
          // Opening a browser is best-effort; the caller prints the URL.
        }
      }

      resolve({ server, url });
    });

    server.on("error", reject);
  });
}

module.exports = {
  startServer,
};
