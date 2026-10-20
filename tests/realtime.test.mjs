import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { createAppServer } from "../server/server.mjs";
import { migrateSnapshot } from "../server/state-store.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function websocketClient(url) {
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = [];
  socket.on("message", (raw) => {
    messages.push(JSON.parse(raw.toString()));
    waiters.splice(0).forEach((resolve) => resolve());
  });
  const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const next = async (type) => {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const index = messages.findIndex((message) => message.type === type);
      if (index >= 0) return messages.splice(index, 1)[0];
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 50);
        waiters.push(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    throw new Error(`Timed out waiting for ${type}`);
  };
  return { socket, opened, next };
}

const initialSnapshot = {
  levels: { BG: { label: "Beginner" }, N: { label: "Normal" }, S: { label: "Strong" } },
  state: {
    members: [{ id: 1, name: "สมาชิกไม่มีเบอร์", phone: "", checkedIn: true }],
    courts: [{ id: 1, name: "สนาม 1", active: true }],
    queues: [],
    ballRounds: [],
    shuttles: [],
    products: [],
    purchases: [],
    payments: {},
    paymentProofs: {},
    settings: { guestEntryFee: 20 },
    analytics: {},
  },
};

test("serves the app, persists state, and broadcasts updates", async () => {
  const temporaryDir = await mkdtemp(path.join(os.tmpdir(), "bat-uthai-"));
  const dataFile = path.join(temporaryDir, "state.json");
  const { server } = await createAppServer({ rootDir: projectRoot, dataFile });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const health = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.persisted, true);
    assert.equal(health.schemaVersion, 1);
    const adminPage = await (await fetch(`${baseUrl}/admin/index.html`)).text();
    assert.match(adminPage, /data-realtime-status/);

    const first = websocketClient(`ws://127.0.0.1:${port}/ws`);
    await first.opened;
    const seedSnapshot = await first.next("state:snapshot");
    assert.equal(seedSnapshot.revision, 0);
    assert.equal(seedSnapshot.data.state.courts.length, 4);
    assert.equal(seedSnapshot.data.state.members.length, 0);
    assert.equal(seedSnapshot.data.state.queues.length, 0);
    assert.equal(seedSnapshot.data.state.ballRounds.length, 0);
    assert.equal(seedSnapshot.data.state.purchases.length, 0);
    const firstSnapshotPromise = first.next("state:snapshot");
    first.socket.send(JSON.stringify({ type: "state:update", data: initialSnapshot }));
    const firstSnapshot = await firstSnapshotPromise;
    assert.equal(firstSnapshot.revision, 1);
    assert.equal(firstSnapshot.data.state.members[0].phone, "");

    const second = websocketClient(`ws://127.0.0.1:${port}/ws`);
    await second.opened;
    const secondSnapshot = await second.next("state:snapshot");
    assert.equal(secondSnapshot.revision, 1);

    const updatedSnapshot = structuredClone(secondSnapshot.data);
    updatedSnapshot.state.members[0].checkedIn = false;
    const updateForFirst = first.next("state:snapshot");
    const updateForSecond = second.next("state:snapshot");
    second.socket.send(JSON.stringify({ type: "state:update", data: updatedSnapshot }));
    assert.equal((await updateForFirst).revision, 2);
    assert.equal((await updateForSecond).data.state.members[0].checkedIn, false);

    const stored = JSON.parse(await readFile(dataFile, "utf8"));
    assert.equal(stored.schemaVersion, 1);
    assert.equal(stored.revision, 2);
    assert.equal(stored.snapshot.state.members[0].checkedIn, false);
    first.socket.close();
    second.socket.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(temporaryDir, { recursive: true, force: true });
  }
});

test("migrates members without a phone number", () => {
  const legacy = structuredClone(initialSnapshot);
  delete legacy.state.members[0].phone;
  const migrated = migrateSnapshot(legacy, 0);
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.snapshot.state.members[0].phone, "");
});
