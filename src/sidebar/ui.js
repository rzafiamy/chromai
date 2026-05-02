const messagesEl = () => document.getElementById('messages');
const typingEl = () => document.getElementById('typing-indicator');

const escapeHtml = (str) => str
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const renderMarkdown = (text) => {
  text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
    `<pre><code>${escapeHtml(code.trim())}</code></pre>`
  );
  text = text.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return text.replace(/\n/g, '<br>');
};

export const renderMessage = (role, content) => {
  const container = messagesEl();
  const div = document.createElement('div');
  div.className = `message message-${role}`;

  if (role === 'user') {
    div.innerHTML = `<span class="msg-label">You</span><div class="msg-body">${escapeHtml(content)}</div>`;
  } else if (role === 'assistant') {
    div.innerHTML = `<span class="msg-label">ChromAI</span><div class="msg-body">${renderMarkdown(content)}</div>`;
  } else {
    div.innerHTML = `<div class="msg-body msg-system">${escapeHtml(content)}</div>`;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
};

export const showTyping = () => {
  let el = typingEl();
  if (!el) {
    el = document.createElement('div');
    el.id = 'typing-indicator';
    el.className = 'typing-indicator';
    el.innerHTML = '<span></span><span></span><span></span>';
    messagesEl().appendChild(el);
  }
  el.style.display = 'flex';
  messagesEl().scrollTop = messagesEl().scrollHeight;
};

export const hideTyping = () => typingEl()?.remove();

export const showConfirm = ({ toolName, description, detail }) =>
  new Promise((resolve) => {
    const container = messagesEl();
    const card = document.createElement('div');
    card.className = 'confirm-card';
    card.innerHTML = `
      <div class="confirm-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <strong>Action required: ${escapeHtml(toolName)}</strong>
      </div>
      <div class="confirm-body">${escapeHtml(description)}</div>
      ${detail ? `<code class="confirm-detail">${escapeHtml(detail)}</code>` : ''}
      <div class="confirm-actions">
        <button class="confirm-btn confirm-cancel">Cancel</button>
        <button class="confirm-btn confirm-ok">Confirm</button>
      </div>
    `;
    card.querySelector('.confirm-ok').addEventListener('click', () => { card.remove(); resolve(true); });
    card.querySelector('.confirm-cancel').addEventListener('click', () => { card.remove(); resolve(false); });
    container.appendChild(card);
    container.scrollTop = container.scrollHeight;
  });

const TOOL_ICONS = {
  getPageContent: '📄', getPageMeta: '🏷️', getSelectedText: '✂️',
  extractLinks: '🔗', extractTable: '📊', getInteractiveElements: '🖱️',
  getForms: '📋', clickElement: '👆', fillForm: '✏️', submitForm: '📤',
  navigateTo: '🌐', scrollPage: '⬇️', scrollAndRead: '📖',
  highlightElement: '🔦', waitForElement: '⏳', analyzePageVisually: '👁️'
};

const TOOL_LABELS = {
  getPageContent: 'Reading page content',
  getPageMeta: 'Reading page metadata',
  getSelectedText: 'Getting selected text',
  extractLinks: 'Extracting links',
  extractTable: 'Extracting table',
  getInteractiveElements: 'Scanning interactive elements',
  getForms: 'Scanning forms',
  clickElement: 'Clicking element',
  fillForm: 'Filling form',
  submitForm: 'Submitting form',
  navigateTo: 'Navigating to page',
  scrollPage: 'Scrolling page',
  scrollAndRead: 'Scrolling and reading',
  highlightElement: 'Highlighting element',
  waitForElement: 'Waiting for element',
  analyzePageVisually: 'Analyzing page visually'
};

export const showToolActivity = (toolName, argsJson) => {
  const container = messagesEl();
  const icon = TOOL_ICONS[toolName] || '⚙️';
  const label = TOOL_LABELS[toolName] || toolName.replace(/([A-Z])/g, ' $1').trim().toLowerCase();

  let detail = '';
  try {
    const { url, selector, fields, direction } = JSON.parse(argsJson || '{}');
    if (url) detail = url;
    else if (selector) detail = selector;
    else if (fields) detail = fields.map(({ selector: s }) => s).join(', ');
    else if (direction) detail = direction;
  } catch { /* ignore */ }

  const div = document.createElement('div');
  div.className = 'tool-activity';
  div.innerHTML = `<span class="tool-activity-icon">${icon}</span><span class="tool-activity-label">${label}${detail ? `<span class="tool-activity-detail"> — ${escapeHtml(String(detail).slice(0, 80))}</span>` : ''}</span><span class="tool-activity-spinner"></span>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
};

export const resolveToolActivity = (div) => {
  if (!div) return;
  div.querySelector('.tool-activity-spinner')?.remove();
  div.classList.add('tool-activity-done');
};
