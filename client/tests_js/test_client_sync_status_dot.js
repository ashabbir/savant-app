"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..", "..");
const file = path.join(ROOT, "client", "renderer", "static", "js", "client-sync.js");
const text = fs.readFileSync(file, "utf8");
const css = fs.readFileSync(path.join(ROOT, "client", "renderer", "static", "css", "shared.css"), "utf8");

assert.ok(text.includes("status-bar-dot idle"), "offline server light should be dim");
assert.ok(text.includes("status-bar-dot active"), "online server light should be bright");
assert.ok(css.includes("opacity: 0.35"), "offline server bulb should be visibly dim");
assert.ok(css.includes("box-shadow: 0 0 0 3px rgba(34,197,94,0.12), 0 0 10px rgba(34,197,94,0.7)"), "online server bulb should have a strong glow");

console.log("✓ client sync status dot");
