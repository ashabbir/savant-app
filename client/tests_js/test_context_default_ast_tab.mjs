import fs from 'fs';
import path from 'path';
import assert from 'assert';

const html = fs.readFileSync(path.resolve('client/renderer/index.html'), 'utf8');
assert.match(html, /class="savant-subtab active" data-panel="ast"/);
assert.doesNotMatch(html, /class="savant-subtab active" data-panel="search"/);
assert.match(html, /id="ctx-panel-ast"/);
assert.match(html, /id="ctx-panel-search" style="display:none;"/);

console.log('✓ context default AST tab');
