// Firewall helpers: describe pending tool calls and highlight affected elements

const DESTRUCTIVE_TOOLS = new Set(['fillForm', 'clickElement', 'submitForm', 'navigateTo']);

export const isDestructiveTool = (toolName) => DESTRUCTIVE_TOOLS.has(toolName);

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

export const highlightOnPage = async (selector) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.tabs.sendMessage(tab.id, { action: 'HIGHLIGHT_ELEMENT', selector, color: '#6366f1' });
  } catch { /* page may not have content script yet */ }
};
