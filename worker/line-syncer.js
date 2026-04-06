"use strict";

const Database = require("better-sqlite3");
const path = require("path");

function getDb() {
  const dbPath =
    (process.env.DATABASE_URL || "").replace("file:", "") ||
    path.join(process.cwd(), "data", "wiremesh.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function syncLines() {
  let db;
  try {
    db = getDb();

    // Get all lines
    const lines = db.prepare("SELECT id, name, status FROM lines").all();

    for (const line of lines) {
      // Get all nodes participating in this line
      const lineNodes = db
        .prepare(
          "SELECT n.id, n.status FROM line_nodes ln JOIN nodes n ON n.id = ln.node_id WHERE ln.line_id = ?"
        )
        .all(line.id);

      if (lineNodes.length === 0) continue;

      // Line is active only if ALL nodes are online
      const allOnline = lineNodes.every((n) => n.status === "online");
      const newStatus = allOnline ? "active" : "inactive";

      if (newStatus !== line.status) {
        db.prepare(
          "UPDATE lines SET status = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(newStatus, line.id);
        console.log(
          `[line-syncer] Line ${line.id} (${line.name}): ${line.status} → ${newStatus}`
        );
      }
    }
  } catch (err) {
    console.error("[line-syncer] Error:", err);
  } finally {
    if (db) db.close();
  }
}

module.exports = { syncLines };
