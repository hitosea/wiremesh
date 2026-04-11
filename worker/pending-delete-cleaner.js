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

function cleanPendingDeletes() {
  let db;
  try {
    db = getDb();

    // Delete nodes marked as pendingDelete for more than 7 days
    const result = db
      .prepare(
        "DELETE FROM nodes WHERE pending_delete = 1 AND updated_at < datetime('now', '-7 days')"
      )
      .run();

    if (result.changes > 0) {
      console.log(`[pending-delete-cleaner] Deleted ${result.changes} stale pending-delete nodes`);
    }
  } catch (err) {
    console.error("[pending-delete-cleaner] Error:", err);
  } finally {
    if (db) db.close();
  }
}

module.exports = { cleanPendingDeletes };
