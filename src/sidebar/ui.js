const messagesEl = () => document.getElementById('messages');
const typingEl = () => document.getElementById('typing-indicator');

const escapeHtml = (str) => str
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Full markdown renderer: headings, bold, italic, code, lists, links
const renderMarkdown = (text) => {
  // Fenced code blocks (must run first)
  text = text.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
    const id = `code-${Math.random().toString(36).slice(2, 8)}`;
    return `<div class="code-block"><div class="code-header">${langLabel}<button class="copy-code-btn" data-target="${id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button></div><pre><code id="${id}">${escapeHtml(code.trim())}</code></pre></div>`;
  });
  // Inline code
  text = text.replace(/`([^`\n]+)`/g, (_, code) => `<code class="inline-code">${escapeHtml(code)}</code>`);
  // Headings
  text = text.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  text = text.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
  text = text.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');
  // Bold + italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // Images (before links so ![...](...) isn't swallowed by the link regex)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) =>
    `<a href="${src}" target="_blank" rel="noopener" class="md-img-link"><img src="${src}" alt="${escapeHtml(alt)}" class="md-img" loading="lazy"></a>`
  );
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>');
  // Unordered lists
  text = text.replace(/((?:^[*\-] .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^[*\-] /, '')}</li>`).join('');
    return `<ul class="md-ul">${items}</ul>`;
  });
  // Ordered lists
  text = text.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol class="md-ol">${items}</ol>`;
  });
  // Tables (GFM style: header row | separator row | data rows)
  text = text.replace(/((?:^(?:\|[^\n]+\|)\n)+)/gm, (block) => {
    const lines = block.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) return block;
    const isSep = (l) => /^\|?[\s\-:|]+\|/.test(l);
    // Find separator row index
    const sepIdx = lines.findIndex(isSep);
    if (sepIdx < 1) return block;
    const parseRow = (l) => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const aligns = parseRow(lines[sepIdx]).map(c => {
      if (/^:-+:$/.test(c)) return 'center';
      if (/^-+:$/.test(c)) return 'right';
      return 'left';
    });
    const headerCells = parseRow(lines[0]).map((c, i) =>
      `<th style="text-align:${aligns[i] || 'left'}">${c}</th>`).join('');
    const bodyRows = lines.slice(sepIdx + 1).map(l => {
      const cells = parseRow(l).map((c, i) =>
        `<td style="text-align:${aligns[i] || 'left'}">${c}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
  });
  // Blockquote
  text = text.replace(/^> (.+)$/gm, '<blockquote class="md-blockquote">$1</blockquote>');
  // Horizontal rule
  text = text.replace(/^---$/gm, '<hr class="md-hr">');
  // Newlines (preserve existing block tags)
  text = text.replace(/\n(?!<\/?(?:ul|ol|li|pre|h[1-6]|blockquote|hr|div|table|thead|tbody|tr|td|th))/g, '<br>');
  return text;
};

const USER_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
const BOT_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="12" rx="3"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M9 18h6" stroke-linecap="round"/></svg>`;
const COPY_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;

const makeCopyButton = (text) => {
  const btn = document.createElement('button');
  btn.className = 'msg-copy-btn';
  btn.title = 'Copy message';
  btn.innerHTML = COPY_ICON;
  btn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(text);
    btn.innerHTML = CHECK_ICON;
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = COPY_ICON; btn.classList.remove('copied'); }, 1800);
  });
  return btn;
};

export const renderMessage = (role, content) => {
  const container = messagesEl();
  const div = document.createElement('div');
  div.className = `message message-${role}`;

  if (role === 'user') {
    div.innerHTML = `
      <div class="msg-avatar msg-avatar-user">${USER_ICON}</div>
      <div class="msg-content">
        <div class="msg-header"><span class="msg-label">You</span></div>
        <div class="msg-body">${escapeHtml(content)}</div>
      </div>`;
    div.querySelector('.msg-content').appendChild(makeCopyButton(content));
  } else if (role === 'assistant') {
    div.innerHTML = `
      <div class="msg-avatar msg-avatar-bot">${BOT_ICON}</div>
      <div class="msg-content">
        <div class="msg-header"><span class="msg-label">ChromAI</span></div>
        <div class="msg-body markdown-body">${renderMarkdown(content)}</div>
      </div>`;
    const msgContent = div.querySelector('.msg-content');
    msgContent.appendChild(makeCopyButton(content));
    // Wire copy-code buttons
    div.querySelectorAll('.copy-code-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.target;
        const code = document.getElementById(id)?.textContent || '';
        await navigator.clipboard.writeText(code);
        const orig = btn.innerHTML;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.innerHTML = orig; }, 1800);
      });
    });
  } else if (role === 'error') {
    div.innerHTML = `<div class="msg-error-inner">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>${escapeHtml(content)}</span></div>`;
  } else {
    div.innerHTML = `<div class="msg-body msg-system">${escapeHtml(content)}</div>`;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
};

export const showToast = (message, type = 'success') => {
  const container = messagesEl();
  const div = document.createElement('div');
  div.className = `msg-toast msg-toast-${type}`;
  const icon = type === 'success'
    ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
    : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>`;
  div.innerHTML = `${icon} ${escapeHtml(message)}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 400); }, 2500);
};

export const showTyping = () => {
  let el = typingEl();
  if (!el) {
    el = document.createElement('div');
    el.id = 'typing-indicator';
    el.className = 'typing-indicator';
    el.innerHTML = `
      <div class="msg-avatar msg-avatar-bot">${BOT_ICON}</div>
      <div class="typing-dots"><span></span><span></span><span></span></div>`;
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
  const check = document.createElement('span');
  check.className = 'tool-done-check';
  check.textContent = '✓';
  div.appendChild(check);
  div.classList.add('tool-activity-done');
};

// ── Agent traceability ─────────────────────────────────────────────────────

export const showIterationBadge = (iteration) => {
  if (iteration == null) return null;
  const container = messagesEl();
  const div = document.createElement('div');
  div.className = 'trace-iteration';
  div.innerHTML = `<span class="trace-iter-label">Step ${iteration}</span>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
};

export const showThinkingText = (text) => {
  if (!text?.trim()) return null;
  const container = messagesEl();
  const div = document.createElement('div');
  div.className = 'trace-thinking';
  // Show a truncated preview — full text appears on expand
  const preview = text.trim().slice(0, 280);
  const isTruncated = text.trim().length > 280;
  div.innerHTML = `
    <span class="trace-thinking-icon">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
      </svg>
    </span>
    <span class="trace-thinking-text">${escapeHtml(preview)}${isTruncated ? '<span class="trace-ellipsis">…</span>' : ''}</span>
    ${isTruncated ? `<button class="trace-expand-btn" data-full="${escapeHtml(text.trim())}">Show more</button>` : ''}`;
  div.querySelector('.trace-expand-btn')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const textEl = div.querySelector('.trace-thinking-text');
    if (btn.dataset.expanded) {
      textEl.textContent = preview;
      textEl.insertAdjacentHTML('beforeend', '<span class="trace-ellipsis">…</span>');
      btn.textContent = 'Show more';
      delete btn.dataset.expanded;
    } else {
      textEl.textContent = btn.dataset.full;
      btn.textContent = 'Show less';
      btn.dataset.expanded = '1';
    }
  });
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
};

const STOP_REASON_LABELS = {
  stop: { label: 'Stopped', detail: 'The model stopped without requesting another tool call. If the task is incomplete, use Continue.', color: 'warning' },
  max_tokens: { label: 'Token limit reached', detail: 'The model ran out of output tokens mid-response.', color: 'error' },
  length: { label: 'Token limit reached', detail: 'The model ran out of output tokens mid-response.', color: 'error' },
  max_steps: { label: 'Step limit reached', detail: 'The agent hit the maximum number of tool calls per run.', color: 'error' },
  max_iterations: { label: 'Iteration limit reached', detail: 'The agent hit the maximum number of LLM iterations.', color: 'error' },
  error: { label: 'Error', detail: 'The model returned an error finish reason.', color: 'error' }
};

export const showStopReason = (reason, _thinkingDiv) => {
  const info = STOP_REASON_LABELS[reason] ?? { label: reason, detail: '', color: 'warning' };
  const container = messagesEl();
  const div = document.createElement('div');
  div.className = `trace-stop trace-stop-${info.color}`;

  const isRecoverable = reason === 'stop' || reason === 'max_steps' || reason === 'max_iterations';

  div.innerHTML = `
    <span class="trace-stop-icon">
      ${info.color === 'error'
        ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
        : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>`
      }
    </span>
    <span class="trace-stop-label">${escapeHtml(info.label)}</span>
    ${info.detail ? `<span class="trace-stop-detail">${escapeHtml(info.detail)}</span>` : ''}
    ${isRecoverable ? `<button class="trace-continue-btn" id="trace-continue-btn">Continue</button>` : ''}`;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
};

export const markContinuation = (iterDiv, action) => {
  if (!iterDiv) return;
  const badge = document.createElement('span');
  badge.className = 'trace-continuation-badge';
  badge.textContent = action ? `↻ ${action}` : '↻ continuing';
  iterDiv.appendChild(badge);
};

export const showBlockedBadge = (toolName) => {
  const container = messagesEl();
  const div = document.createElement('div');
  div.className = 'trace-blocked';
  div.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> <span>${escapeHtml(toolName)} blocked by firewall</span>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
};

export const updateModelBadge = (model) => {
  const badge = document.getElementById('model-badge');
  if (badge) badge.textContent = model || '';
};
