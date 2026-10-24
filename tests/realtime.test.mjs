import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { createAppServer } from "../server/server.mjs";
import { migrateSnapshot, resetTransactionalState } from "../server/state-store.mjs";

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
    assert.equal(health.schemaVersion, 2);
    const adminPage = await (await fetch(`${baseUrl}/admin/index.html`)).text();
    assert.match(adminPage, /data-realtime-status/);

    const first = websocketClient(`ws://127.0.0.1:${port}/ws`);
    await first.opened;
    const seedSnapshot = await first.next("state:snapshot");
    assert.equal((await first.next("presence")).clients, 1);
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
    assert.equal((await first.next("presence")).clients, 2);
    assert.equal((await second.next("presence")).clients, 2);

    const updatedSnapshot = structuredClone(secondSnapshot.data);
    updatedSnapshot.state.members[0].checkedIn = false;
    const updateForFirst = first.next("state:snapshot");
    const updateForSecond = second.next("state:snapshot");
    second.socket.send(JSON.stringify({ type: "state:update", data: updatedSnapshot }));
    assert.equal((await updateForFirst).revision, 2);
    assert.equal((await updateForSecond).data.state.members[0].checkedIn, false);

    const stored = JSON.parse(await readFile(dataFile, "utf8"));
    assert.equal(stored.schemaVersion, 2);
    assert.equal(stored.revision, 2);
    assert.equal(stored.snapshot.state.members[0].checkedIn, false);
    second.socket.close();
    assert.equal((await first.next("presence")).clients, 1);
    first.socket.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(temporaryDir, { recursive: true, force: true });
  }
});

test("migrates members and separates legacy developer fees", () => {
  const legacy = structuredClone(initialSnapshot);
  delete legacy.state.members[0].phone;
  legacy.state.ballRounds = [{ id: 1, balls: 2, ballCost: 90, fee: 10, playerIds: [1, 1, 1, 1] }];
  const migrated = migrateSnapshot(legacy, 0);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.snapshot.state.members[0].phone, "");
  assert.equal(migrated.snapshot.state.settings.systemChargeMode, "free");
  assert.equal(migrated.snapshot.state.ballRounds[0].developerFee, 10);
  assert.equal("fee" in migrated.snapshot.state.ballRounds[0], false);
});

test("resets transactions while preserving members and master data", () => {
  const populated = structuredClone(initialSnapshot);
  populated.state.members[0].visitedToday = true;
  populated.state.members[0].previousDue = 125;
  populated.state.queues = [{ id: 1, playerIds: [1], status: "waiting" }];
  populated.state.ballRounds = [{ id: 1, playerIds: [1] }];
  populated.state.purchases = [{ id: 1, personId: 1 }];
  populated.state.payments = { 1: false };
  populated.state.paymentProofs = { 1: { submittedAt: Date.now() } };
  populated.state.analytics = { revenueBeforeToday: { month: 500, year: 1000 }, lastSixDays: [1, 2, 3, 4, 5, 6] };

  const reset = resetTransactionalState(populated);
  assert.equal(reset.state.members.length, 1);
  assert.equal(reset.state.members[0].name, "สมาชิกไม่มีเบอร์");
  assert.equal(reset.state.members[0].checkedIn, false);
  assert.equal(reset.state.members[0].visitedToday, false);
  assert.equal(reset.state.members[0].previousDue, 0);
  assert.equal(reset.state.courts.length, 1);
  assert.deepEqual(reset.state.queues, []);
  assert.deepEqual(reset.state.ballRounds, []);
  assert.deepEqual(reset.state.purchases, []);
  assert.deepEqual(reset.state.payments, {});
  assert.deepEqual(reset.state.paymentProofs, {});
  assert.equal(reset.state.analytics.revenueBeforeToday.year, 0);
});
