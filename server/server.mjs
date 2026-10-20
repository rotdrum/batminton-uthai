import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { createStateWriter, CURRENT_SCHEMA_VERSION, isValidSnapshot, loadState } from "./state-store.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(moduleDir, "..");
const MAX_MESSAGE_BYTES = 5 * 1024 * 1024;
const blockedPaths = ["/.git", "/data", "/node_modules", "/server", "/tests"];

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

export async function createAppServer({
  rootDir = defaultRootDir,
  dataFile = path.join(rootDir, "data/state.json"),
  seedFile = path.join(rootDir, "data/seed.json"),
} = {}) {
  const stored = await loadState({ dataFile, seedFile });
  let snapshot = stored.snapshot;
  let revision = stored.revision || 0;
  let updatedAt = stored.updatedAt || null;
  let schemaVersion = stored.schemaVersion || CURRENT_SCHEMA_VERSION;
  const writeState = createStateWriter(dataFile);
  const persist = () => writeState({ schemaVersion, revision, updatedAt, snapshot });
  if (stored.needsPersist) await persist();

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://localhost");
      if (request.method === "GET" && requestUrl.pathname === "/api/health") {
        return json(response, 200, { ok: true, clients: wss.clients.size, schemaVersion, revision, updatedAt, persisted: true });
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/state") {
        return json(response, 200, { schemaVersion, revision, updatedAt, snapshot });
      }
      if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: "Method not allowed" });
      if (blockedPaths.some((prefix) => requestUrl.pathname === prefix || requestUrl.pathname.startsWith(`${prefix}/`))) {
        return json(response, 404, { error: "Not found" });
      }

      let relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
      if (!relativePath || relativePath.endsWith("/")) relativePath += "index.html";
      if (!path.extname(relativePath)) relativePath = path.join(relativePath, "index.html");
      const filePath = path.resolve(rootDir, relativePath);
      if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${path.sep}`)) return json(response, 403, { error: "Forbidden" });

      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) return json(response, 404, { error: "Not found" });
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": fileStat.size,
        "content-type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      });
      if (request.method === "HEAD") return response.end();
      createReadStream(filePath).pipe(response);
    } catch (error) {
      if (error.code === "ENOENT") return json(response, 404, { error: "Not found" });
      console.error(error);
      json(response, 500, { error: "Internal server error" });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  const broadcast = (message) => {
    const encoded = JSON.stringify(message);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(encoded);
    });
  };

  const broadcastPresence = () => broadcast({ type: "presence", clients: wss.clients.size });

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url || "/", "http://localhost");
    if (requestUrl.pathname !== "/ws") return socket.destroy();
    wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client, request));
  });

  wss.on("connection", (client) => {
    client.send(JSON.stringify({ type: "state:snapshot", schemaVersion, revision, updatedAt, data: snapshot }));
    broadcastPresence();

    client.on("message", async (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());
        if (!["state:bootstrap", "state:update"].includes(message.type)) return;
        if (message.type === "state:bootstrap") {
          return client.send(JSON.stringify({ type: "state:snapshot", schemaVersion, revision, updatedAt, data: snapshot }));
        }
        if (!isValidSnapshot(message.data)) {
          return client.send(JSON.stringify({ type: "error", message: "Invalid shared state" }));
        }

        // shortcut: full-state last-write-wins is enough for one local club; move mutations to server commands when concurrent writers grow.
        snapshot = message.data;
        revision += 1;
        updatedAt = new Date().toISOString();
        await persist();
        broadcast({ type: "state:snapshot", schemaVersion, revision, updatedAt, data: snapshot });
      } catch (error) {
        console.error(error);
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "error", message: "Cannot process message" }));
      }
    });

    client.on("close", broadcastPresence);
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.ping();
    });
  }, 30_000);
  heartbeat.unref();

  server.on("close", () => {
    clearInterval(heartbeat);
    wss.clients.forEach((client) => client.close());
  });

  return { server, wss, getState: () => ({ schemaVersion, revision, updatedAt, snapshot }) };
}

export async function startServer({ host = process.env.HOST || "127.0.0.1", port = Number(process.env.PORT || 8080), dataFile = process.env.DATA_FILE } = {}) {
  const appServer = await createAppServer({ dataFile });
  await new Promise((resolve, reject) => {
    appServer.server.once("error", reject);
    appServer.server.listen(port, host, resolve);
  });
  const address = appServer.server.address();
  console.log(`Uthai Smash running at http://${host}:${address.port}`);
  return appServer;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
