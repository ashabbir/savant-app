import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';

const JS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../renderer/static/js');
const code = fs.readFileSync(path.join(JS_DIR, 'globals.js'), 'utf8');

const overlay = { style: { display: 'flex' } };

const sandbox = {
  window: {},
  document: {
    getElementById: id => (id === 'startup-overlay' ? overlay : null),
  },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
  },
  setTimeout,
  clearTimeout,
  console,
};
sandbox.window = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'globals.js' });

assert.equal(typeof sandbox.savantAfterStartup, 'function');
assert.equal(typeof sandbox._resolveSavantStartupReady, 'function');

let ran = false;
sandbox.savantAfterStartup(() => { ran = true; });
assert.equal(ran, false);

sandbox._savantStartStartupDelay(10);
await new Promise(resolve => setTimeout(resolve, 800));

assert.equal(ran, true);
assert.equal(overlay.style.display, 'none');

console.log('✓ startup gate');
