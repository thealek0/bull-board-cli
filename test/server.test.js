const { test } = require("node:test");
const assert = require("node:assert/strict");

const { startServer } = require("../src/server");

test("startServer binds a port and serves the board without opening a browser", async () => {
  const { server, url } = await startServer({
    redis: {},
    queues: [],
    prefix: "bull",
    port: 0, // ephemeral port
    launchBrowser: false,
    title: "test-board",
  });

  try {
    const { address, port } = server.address();
    assert.ok(port > 0);
    // The returned URL must reflect the bound host and port, not the requested
    // port 0.
    assert.equal(url, `http://${address}:${port}/queues`);

    const res = await fetch(`http://localhost:${port}/queues`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /test-board/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("startServer binds to loopback by default (not exposed to the network)", async () => {
  const { server } = await startServer({
    redis: {},
    queues: [],
    port: 0,
    launchBrowser: false,
  });

  try {
    assert.equal(server.address().address, "127.0.0.1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("startServer works without a title (default board config branch)", async () => {
  const { server } = await startServer({
    redis: {},
    queues: [],
    port: 0,
    launchBrowser: false,
  });

  try {
    const { port } = server.address();
    const res = await fetch(`http://localhost:${port}/queues`);
    assert.equal(res.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
