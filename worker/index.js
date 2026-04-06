"use strict";

const { checkNodes } = require("./node-checker");
const { syncLines } = require("./line-syncer");
const { cleanData } = require("./data-cleaner");

const CHECK_INTERVAL = 5 * 60 * 1000;   // 5 minutes
const CLEAN_INTERVAL = 60 * 60 * 1000;  // 1 hour
const INITIAL_DELAY = 30 * 1000;        // 30 seconds

console.log("[worker] Starting WireMesh worker process...");

function runChecks() {
  console.log("[worker] Running node check + line sync...");
  checkNodes();
  syncLines();
}

function runClean() {
  console.log("[worker] Running data cleanup...");
  cleanData();
}

// Start after initial delay
setTimeout(() => {
  // Initial run
  runChecks();
  runClean();

  // Schedule recurring tasks
  setInterval(runChecks, CHECK_INTERVAL);
  setInterval(runClean, CLEAN_INTERVAL);

  console.log(
    `[worker] Scheduled: checks every ${CHECK_INTERVAL / 1000}s, cleanup every ${CLEAN_INTERVAL / 1000}s`
  );
}, INITIAL_DELAY);

console.log(`[worker] Initial run scheduled in ${INITIAL_DELAY / 1000}s`);
