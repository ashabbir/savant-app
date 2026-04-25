"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..", "..");
const file = path.join(ROOT, "client", "renderer", "static", "js", "sessions.js");
const text = fs.readFileSync(file, "utf8");
const html = fs.readFileSync(path.join(ROOT, "client", "renderer", "index.html"), "utf8");

assert.ok(text.includes("function _getVisibleBulkCards()"), "bulk toggle should target visible cards");
assert.ok(text.includes("function toggleAllFilteredSelection()"), "bulk toggle action should exist");
assert.ok(text.includes("window.savantClient.deleteLocalSession"), "bulk delete should use the local delete bridge when available");
assert.ok(text.includes("_deleteEndpointFor(item.provider, item.id)"), "bulk delete fallback should delete each selected session individually");
assert.ok(text.includes("bulkMode || document.body.classList.contains('bulk-mode')"), "card clicks should toggle selection in purge mode");
assert.ok(text.includes("function exitBulkMode()"), "bulk mode should expose an explicit exit helper");
assert.ok(!text.includes("title=\"Copy resume command\""), "session cards should not show the copy resume icon");
assert.ok(html.includes("TOGGLE ALL"), "purge UI should expose toggle-all control");

console.log("✓ sessions bulk toggle");
