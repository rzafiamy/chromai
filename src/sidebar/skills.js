// Firewall helpers: describe pending tool calls and highlight affected elements

import { getFocusRegion, injectContentScript } from './tools.js';

const DESTRUCTIVE_TOOLS = new Set(['fillForm', 'clickElement', 'submitForm', 'navigateTo']);

export const isDestructiveTool = (toolName) => DESTRUCTIVE_TOOLS.has(toolName);

// Every CSS selector a pending tool call will touch (so we can highlight all of
// them, e.g. all fields in a fillForm). Returns [] for selector-less actions.
export const selectorsForToolCall = (toolName, argsJson) => {
  try {
    const args = JSON.parse(argsJson);
    if (toolName === 'fillForm') return (args.fields || []).map((f) => f.selector).filter(Boolean);
    if (args.selector) return [args.selector];
  } catch { /* ignore parse errors */ }
  return [];
};

export const describeToolCall = (toolName, argsJson) => {
  try {
    const args = JSON.parse(argsJson);
    if (toolName === 'fillForm') {
      const fields = (args.fields || []).map(({ value, selector }) => `"${value}" → ${selector}`).join('\n');
      return { description: 'Fill form fields with the values below:', detail: fields };
    }
    if (toolName === 'clickElement') return { description: `Click element: ${args.selector}`, detail: args.selector };
    if (toolName === 'submitForm')  return { description: `Submit form: ${args.selector}`, detail: args.selector };
    if (toolName === 'navigateTo')  return { description: 'Navigate to:', detail: args.url };
  } catch { /* ignore parse errors */ }
  return { description: toolName, detail: argsJson.slice(0, 120) };
};

// Persistent RED highlight of the element(s) a pending action will touch.
// Stays visible for the whole confirm decision (does not auto-clear) and scopes
// to the active focus region so it marks the SAME element the action will hit.
// Returns the number of elements highlighted (0 = nothing to show, e.g. navigateTo).
const _sendConfirmHighlight = (tabId, selectors, rootSelector) =>
  new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: 'CONFIRM_HIGHLIGHT', selectors, rootSelector }, (res) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      resolve(res?.highlighted ?? 0);
    });
  });

export const showConfirmHighlight = async (selectors) => {
  if (!selectors?.length) return 0;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return 0;
    const rootSelector = getFocusRegion() || undefined;
    try {
      return await _sendConfirmHighlight(tab.id, selectors, rootSelector);
    } catch {
      // Content script not yet injected — inject and retry once.
      await injectContentScript(tab.id);
      await new Promise((r) => setTimeout(r, 150));
      return await _sendConfirmHighlight(tab.id, selectors, rootSelector);
    }
  } catch { return 0; }
};

export const clearConfirmHighlight = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_CONFIRM_HIGHLIGHT' });
  } catch { /* ignore */ }
};
