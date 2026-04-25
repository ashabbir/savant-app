"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..", "..");
const text = fs.readFileSync(path.join(ROOT, "client", "renderer", "static", "js", "sessions.js"), "utf8");

assert.ok(text.includes("let _bulkSelectedIds = new Set();"), "bulk selection should persist across rerenders");
assert.ok(text.includes("newCb.checked = _bulkSelectedIds.has(s.id)"), "rerender should restore selected checkboxes");
assert.ok(text.includes("_bulkSelectedIds.delete(id)"), "deleted sessions should be removed from selection cache");

console.log("✓ sessions bulk selection persistence");
