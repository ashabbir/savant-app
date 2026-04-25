import fs from 'fs';
import path from 'path';
import assert from 'assert';

const terminalJs = fs.readFileSync(path.resolve('renderer/static/js/terminal.js'), 'utf8');
const terminalHtml = fs.readFileSync(path.resolve('terminal.html'), 'utf8');

assert.ok(
  terminalJs.includes("import('../xterm.mjs')") || terminalHtml.includes("import('./renderer/static/xterm.mjs')"),
  'xterm import path should resolve in the Electron app'
);
assert.ok(
  terminalJs.includes("import('../xterm-addon-fit.mjs')") || terminalHtml.includes("import('./renderer/static/xterm-addon-fit.mjs')"),
  'fit addon import path should resolve in the Electron app'
);

console.log('✓ terminal xterm import path');
