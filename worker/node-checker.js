"use strict";

const Database = require("better-sqlite3");
const path = require("path");

const OFFLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function getDb() {
  const dbPath =
    (process.env.DATABASE_URL || "").replace("file:", "") ||
    path.join(process.cwd(), "data", "wiremesh.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function checkNodes() {
  let db;
  try {
    db = getDb();

    // Get all nodes that are currently marked online
    const onlineNodes = db
      .prepare("SELECT id, name FROM nodes WHERE status = 'online'")
      .all();

    const thresholdTime = new Date(Date.now() - OFFLINE_THRESHOLD_MS)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, "");

    const updateOffline = db.prepare(
      "UPDATE nodes SET status = 'offline', updated_at = datetime('now') WHERE id = ?"
    );

    for (const node of onlineNodes) {
      // Check if there's a recent node_status record
      const recentStatus = db
        .prepare(
          "SELECT id FROM node_status WHERE node_id = ? AND checked_at > ? LIMIT 1"
        )
        .get(node.id, thresholdTime);

      if (!recentStatus) {
        updateOffline.run(node.id);
        console.log(
          `[node-checker] Node ${node.id} (${node.name}) marked offline — no recent status report`
        );
      }
    }
  } catch (err) {
    console.error("[node-checker] Error:", err);
  } finally {
    if (db) db.close();
  }
}

module.exports = { checkNodes };
