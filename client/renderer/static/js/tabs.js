/**
 * tabs.js — Shared tab switching component for Savant.
 *
 * Usage:
 *   savantSwitchTab(tabName, container)
 *     - tabName:   the data-tab value to activate
 *     - container: CSS selector for the parent scope (default: document)
 *
 * HTML pattern:
 *   <div class="savant-tabs">
 *     <button class="savant-tab active" data-tab="one" onclick="savantSwitchTab('one', '.my-scope')">ONE</button>
 *     <button class="savant-tab" data-tab="two" onclick="savantSwitchTab('two', '.my-scope')">TWO</button>
 *   </div>
 *   <div class="savant-tab-panel active" id="panel-one">...</div>
 *   <div class="savant-tab-panel" id="panel-two">...</div>
 */

function savantSwitchTab(tabName, container) {
  var scope = container ? document.querySelector(container) : document;
  if (!scope) scope = document;

  // Toggle tab buttons
  scope.querySelectorAll('.savant-tab, .savant-subtab').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });

  // Toggle tab panels
  scope.querySelectorAll('.savant-tab-panel').forEach(function(panel) {
    panel.classList.toggle('active', panel.id === 'panel-' + tabName);
  });
}
