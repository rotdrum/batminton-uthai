import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const CURRENT_SCHEMA_VERSION = 1;

export function isValidSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.state || typeof snapshot.state !== "object") return false;
  const arrays = ["members", "courts", "queues", "ballRounds", "shuttles", "products", "purchases"];
  const objects = ["payments", "paymentProofs", "settings", "analytics"];
  return arrays.every((key) => Array.isArray(snapshot.state[key]))
    && objects.every((key) => snapshot.state[key] && typeof snapshot.state[key] === "object" && !Array.isArray(snapshot.state[key]))
    && snapshot.levels && typeof snapshot.levels === "object" && !Array.isArray(snapshot.levels);
}

export function migrateSnapshot(snapshot, fromVersion = 0) {
  const migrated = structuredClone(snapshot);
  let schemaVersion = Number(fromVersion) || 0;

  if (schemaVersion < 1) {
    migrated.state.members = migrated.state.members.map((member) => ({
      ...member,
      phone: typeof member.phone === "string" ? member.phone : "",
    }));
    migrated.state.settings = {
      guestEntryFee: 20,
      annualMemberFee: 0,
      systemChargeMode: "per_shuttle",
      systemFeePerShuttle: 5,
      monthlySystemFee: 1500,
      ...migrated.state.settings,
    };
    schemaVersion = 1;
  }

  return { snapshot: migrated, schemaVersion };
}

export function resetTransactionalState(snapshot) {
  const reset = structuredClone(snapshot);
  reset.state.members = reset.state.members.map((member) => ({
    ...member,
    checkedIn: false,
    visitedToday: false,
    previousDue: 0,
  }));
  reset.state.queues = [];
  reset.state.ballRounds = [];
  reset.state.purchases = [];
  reset.state.payments = {};
  reset.state.paymentProofs = {};
  reset.state.analytics = {
    revenueBeforeToday: { month: 0, year: 0 },
    lastSixDays: [0, 0, 0, 0, 0, 0],
  };
  return reset;
}

export async function loadState({ dataFile, seedFile }) {
  try {
    const stored = JSON.parse(await readFile(dataFile, "utf8"));
    if (!isValidSnapshot(stored.snapshot)) throw new Error(`Invalid state file: ${dataFile}`);
    const migrated = migrateSnapshot(stored.snapshot, stored.schemaVersion);
    return {
      ...stored,
      ...migrated,
      needsPersist: migrated.schemaVersion !== stored.schemaVersion,
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const seed = JSON.parse(await readFile(seedFile, "utf8"));
    if (!isValidSnapshot(seed.snapshot)) throw new Error(`Invalid seed file: ${seedFile}`);
    const migrated = migrateSnapshot(seed.snapshot, seed.schemaVersion);
    return {
      revision: 0,
      updatedAt: null,
      ...migrated,
      needsPersist: true,
    };
  }
}

export function createStateWriter(dataFile) {
  let writeQueue = Promise.resolve();
  return (payload) => {
    const temporaryFile = `${dataFile}.tmp`;
    writeQueue = writeQueue.then(async () => {
      await mkdir(path.dirname(dataFile), { recursive: true });
      await writeFile(temporaryFile, JSON.stringify(payload, null, 2), "utf8");
      await rename(temporaryFile, dataFile);
    });
    return writeQueue;
  };
}
