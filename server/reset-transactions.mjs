import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStateWriter, loadState, resetTransactionalState } from "./state-store.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = process.env.DATA_FILE || path.join(projectRoot, "data/state.json");
const seedFile = path.join(projectRoot, "data/seed.json");
const stored = await loadState({ dataFile, seedFile });
const timestamp = new Date().toISOString().replaceAll(":", "-");
const backupFile = `${dataFile}.backup-${timestamp}`;

try {
  await copyFile(dataFile, backupFile);
  console.log(`Backup: ${backupFile}`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.log("No existing state file; starting from seed data.");
}

const snapshot = resetTransactionalState(stored.snapshot);
const revision = (stored.revision || 0) + 1;
const updatedAt = new Date().toISOString();
await createStateWriter(dataFile)({ schemaVersion: stored.schemaVersion, revision, updatedAt, snapshot });

console.log(`Reset transactions: ${dataFile}`);
console.log(`Preserved ${snapshot.state.members.length} members and all master data.`);
