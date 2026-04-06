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

function cleanData() {
  let db;
  try {
    db = getDb();

    // Delete node_status records older than 7 days
    const result = db
      .prepare(
        "DELETE FROM node_status WHERE checked_at < datetime('now', '-7 days')"
      )
      .run();

    if (result.changes > 0) {
      console.log(`[data-cleaner] Deleted ${result.changes} old node_status records`);
    }
  } catch (err) {
    console.error("[data-cleaner] Error:", err);
  } finally {
    if (db) db.close();
  }
}

module.exports = { cleanData };
