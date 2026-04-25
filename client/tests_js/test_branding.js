"use strict";

const fs = require("fs");
const path = require("path");

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
  } catch (e) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${e.message}`);
    process.exitCode = 1;
  }
}

const loadingHtml = fs.readFileSync(path.resolve(__dirname, "../loading.html"), "utf8");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../renderer/index.html"), "utf8");
const coreJs = fs.readFileSync(path.resolve(__dirname, "../renderer/static/js/core.js"), "utf8");
const icon512 = fs.readFileSync(path.resolve(__dirname, "../icon.png"));
const icon256 = fs.readFileSync(path.resolve(__dirname, "../icon_256.png"));

test("loading screen uses a tech-style SVG logo instead of a plain S badge", () => {
  if (loadingHtml.includes('<div class="logo">S</div>')) {
    throw new Error("loading screen still contains the old S badge");
  }
  if (!loadingHtml.includes('<svg') || !loadingHtml.includes('logo-grd')) {
    throw new Error("loading screen logo SVG is missing");
  }
});

test("top bar logo uses the tech-style SVG mark", () => {
  if (!indexHtml.includes('savant-logo') || !indexHtml.includes('top-logo-grd')) {
    throw new Error("top bar logo SVG is missing");
  }
});

test("runtime header logo svg string is updated", () => {
  if (!coreJs.includes('logo-grd') || !coreJs.includes('SAVANT')) {
    throw new Error("core.js logo SVG string was not updated");
  }
});

test("app icon png assets exist and are valid PNGs", () => {
  if (icon512.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    throw new Error("icon.png is not a PNG");
  }
  if (icon256.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    throw new Error("icon_256.png is not a PNG");
  }
});
