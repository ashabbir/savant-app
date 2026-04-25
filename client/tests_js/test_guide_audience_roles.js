/**
 * Regression test for the guide audience section.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const guideJs = fs.readFileSync(path.resolve(__dirname, '../renderer/guide.js'), 'utf8');

function assertIncludes(label, needle) {
  if (!guideJs.includes(needle)) {
    throw new Error(`${label} missing: ${needle}`);
  }
}

assertIncludes('plan lane', 'title: \'Plan\'');
assertIncludes('execute lane', 'title: \'Execute\'');
assertIncludes('verify lane', 'title: \'Verify\'');
assertIncludes('support lane', 'title: \'Support\'');
assertIncludes('product role', 'Product managers and tech leads');
assertIncludes('qa role', 'QA teams validate scenarios');
assertIncludes('support role', 'Support agents use it as a runbook');
assertIncludes('server vars', 'Server-side variables');
assertIncludes('client vars', 'Client-side variables');
assertIncludes('github token', '<code>GITHUB_TOKEN</code>');
assertIncludes('server url', '<code>SAVANT_SERVER_URL</code>');
assertIncludes('system info split', 'Context Sources');
assertIncludes('client settings', 'Client Settings');

console.log('✓ guide audience roles');
