const messagesEl = () => document.getElementById('messages');
const typingEl = () => document.getElementById('typing-indicator');

const escapeHtml = (str) => str
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Full markdown renderer: headings, bold, italic, code, lists, links
export const renderMarkdown = (text) => {
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

// ── Welcome screen helpers ─────────────────────────────────────────────────

/** Return a friendly time-of-day word and a weekday label. */
const getTimeContext = () => {
  const now = new Date();
  const h = now.getHours();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekday = days[now.getDay()];
  let period;
  if (h < 12)      period = 'morning';
  else if (h < 17) period = 'afternoon';
  else if (h < 21) period = 'evening';
  else             period = 'night';
  return { weekday, period };
};

/** Parse domain from a URL string. Returns null on failure. */
const parseDomain = (url) => {
  try {
    const u = new URL(url);
    // Strip leading "www."
    return u.hostname.replace(/^www\./, '');
  } catch { return null; }
};

/**
 * Domain-aware chip definitions.
 * Each rule: { match: RegExp, chips: [{ label, prompt }] }
 */
const DOMAIN_CHIPS = [
  { match: /github\.com/,
    chips: [
      { label: '📝 Summarize repo', prompt: 'Summarize this GitHub repository: what does it do, main languages, and recent activity.' },
      { label: '🐛 List open issues', prompt: 'List the open issues or PRs on this page.' },
      { label: '📦 README summary', prompt: 'Summarize the README of this repository.' }
    ]
  },
  { match: /youtube\.com|youtu\.be/,
    chips: [
      { label: '🎬 Describe video', prompt: 'What is this YouTube video about? Give me a quick summary.' },
      { label: '📋 List videos', prompt: 'List all the video titles visible on this page.' },
      { label: '💬 Read comments', prompt: 'Read the top comments on this video.' }
    ]
  },
  { match: /twitter\.com|x\.com/,
    chips: [
      { label: '🐦 Summarize feed', prompt: 'Summarize the top posts or tweets visible on this page.' },
      { label: '🔍 Find trending', prompt: 'What trending topics or hashtags are visible on this page?' },
      { label: '📌 Read thread', prompt: 'Read and summarize the thread on this page.' }
    ]
  },
  { match: /linkedin\.com/,
    chips: [
      { label: '👤 Summarize profile', prompt: 'Summarize the LinkedIn profile on this page.' },
      { label: '💼 List jobs', prompt: 'List the job postings visible on this page.' },
      { label: '📰 Summarize feed', prompt: 'Summarize the most relevant posts in my feed.' }
    ]
  },
  { match: /notion\.so|notion\.site/,
    chips: [
      { label: '📄 Summarize page', prompt: 'Summarize the content of this Notion page.' },
      { label: '☑️ List tasks', prompt: 'List all tasks or to-dos visible on this page.' },
      { label: '🔗 Extract links', prompt: 'Extract all links or references on this Notion page.' }
    ]
  },
  { match: /stackoverflow\.com|stackexchange\.com/,
    chips: [
      { label: '✅ Best answer', prompt: 'What is the best answer to this Stack Overflow question? Summarize it.' },
      { label: '❓ Question summary', prompt: 'Summarize the question being asked on this page.' },
      { label: '📋 List answers', prompt: 'List all answers and their vote counts on this page.' }
    ]
  },
  { match: /reddit\.com/,
    chips: [
      { label: '📖 Summarize thread', prompt: 'Summarize this Reddit thread: the post and top comments.' },
      { label: '💬 Top comments', prompt: 'Read and list the top 5 comments in this Reddit thread.' },
      { label: '🏷️ Post details', prompt: 'What is this post about? Give me the key details.' }
    ]
  },
  { match: /google\.com\/search|bing\.com\/search|duckduckgo\.com/,
    chips: [
      { label: '🔍 Summarize results', prompt: 'Summarize the top search results visible on this page.' },
      { label: '🔗 Extract links', prompt: 'List all result links and their descriptions.' },
      { label: '📰 Find best result', prompt: 'Which result looks most relevant to the query? Explain why.' }
    ]
  },
  { match: /docs\.|documentation|readme|readthedocs/,
    chips: [
      { label: '📘 Summarize docs', prompt: 'Summarize this documentation page.' },
      { label: '💡 Key concepts', prompt: 'What are the key concepts or APIs described on this page?' },
      { label: '🔍 Find examples', prompt: 'Find and list any code examples on this page.' }
    ]
  },
];

const DEFAULT_CHIPS = [
  { label: 'Summarize page', prompt: 'Summarize this page' },
  { label: 'Extract links', prompt: 'Extract all links from this page' },
  { label: 'Main topics', prompt: 'What are the main topics on this page?' },
];

/** Return chip definitions appropriate for the given URL. */
const chipsFor = (url) => {
  if (url) {
    for (const rule of DOMAIN_CHIPS) {
      if (rule.match.test(url)) return rule.chips;
    }
  }
  return DEFAULT_CHIPS;
};

// The empty-session screen: ChromAI icon + greeting + quick-prompt chips.
// Accepts optional context: { url, title } from the active tab.
// Kept in one place so both paths (initial load + clear chat) stay in sync.
export const renderWelcome = (tabCtx = null) => {
  const container = messagesEl();
  if (!container || container.querySelector('.welcome-message')) return;

  const { weekday, period } = getTimeContext();
  const domain  = tabCtx?.url   ? parseDomain(tabCtx.url) : null;
  const title   = tabCtx?.title ? tabCtx.title.trim()     : null;
  const chips   = chipsFor(tabCtx?.url);

  // Build greeting
  const greeting = domain
    ? `Good ${period}! I'm ChromAI, your AI browser copilot.`
    : `Hi, I'm ChromAI — your AI browser copilot.`;

  // Build sub-line with domain + time context
  const sub = domain
    ? `On this ${weekday} ${period} I'm ready to help you navigate <strong>${escapeHtml(domain)}</strong>${title ? ` — <em>${escapeHtml(title.slice(0, 60))}${title.length > 60 ? '…' : ''}</em>` : ''}. Ask me anything.`
    : `Ask me to read, summarize, click, or interact with this page.`;

  // Debug info strip (domain + local time — useful for development)
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const debugInfo = domain
    ? `<div class="welcome-debug">
        <span class="welcome-debug-item">🌐 ${escapeHtml(domain)}</span>
        <span class="welcome-debug-sep">·</span>
        <span class="welcome-debug-item">🕐 ${weekday}, ${timeStr}</span>
        ${tabCtx?.url ? `<span class="welcome-debug-sep">·</span><span class="welcome-debug-item welcome-debug-url" title="${escapeHtml(tabCtx.url)}">${escapeHtml(tabCtx.url.slice(0, 48))}${tabCtx.url.length > 48 ? '…' : ''}</span>` : ''}
      </div>`
    : '';

  const chipsHtml = chips.map(c =>
    `<button class="welcome-chip" data-prompt="${escapeHtml(c.prompt)}">${c.label}</button>`
  ).join('');

  const div = document.createElement('div');
  div.className = 'welcome-message';
  div.innerHTML = `
    <div class="welcome-logo">
      <img src="${new URL('../../public/icons/icon-128.png', import.meta.url).href}" class="welcome-logo-img" alt="ChromAI">
    </div>
    <p class="welcome-title">${escapeHtml(greeting)}</p>
    <p class="welcome-sub">${sub}</p>
    ${debugInfo}
    <div class="welcome-chips">${chipsHtml}</div>`;
  container.appendChild(div);
};

export const renderMessage = (role, content) => {
  const container = messagesEl();

  // Clear the welcome message screen on the first prompt
  const welcomeEl = container.querySelector('.welcome-message');
  if (welcomeEl) {
    welcomeEl.remove();
  }

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

const TOOL_ICONS = {
  getPageContent: '📄', getPageMeta: '🏷️', getSelectedText: '✂️',
  extractLinks: '🔗', extractTable: '📊', getInteractiveElements: '🖱️',
  getForms: '📋', clickElement: '👆', fillForm: '✏️', submitForm: '📤',
  navigateTo: '🌐', scrollPage: '⬇️', scrollAndRead: '📖',
  highlightElement: '🔦', waitForElement: '⏳', waitForIdle: '⌛', analyzePageVisually: '👁️',
  findActionButton: '🎯', findCommentBox: '💬', dismissOverlay: '🚫',
  classifyPage: '🧭', searchOnPage: '🔍', readThread: '🧵', writeToRegion: '✍️',
  typeText: '⌨️', pressKey: '⏎', captureRegion: '📸', ocrRegion: '📝'
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
  waitForIdle: 'Waiting for page to settle',
  analyzePageVisually: 'Analyzing page visually',
  findActionButton: 'Finding button',
  findCommentBox: 'Finding comment box',
  dismissOverlay: 'Dismissing overlay',
  classifyPage: 'Classifying page',
  searchOnPage: 'Searching page',
  readThread: 'Reading thread',
  writeToRegion: 'Writing to region',
  typeText: 'Typing text',
  pressKey: 'Pressing key',
  captureRegion: 'Capturing region',
  ocrRegion: 'Extracting text from region'
};

// Resolves true (confirm), false (cancel), or 'retarget' when the user wants to
// pick a different target element for the action (allowRetarget only).
export const showConfirm = ({ toolName, description, detail, notFound = false, allowRetarget = false, abortHandle }) =>
  new Promise((resolve) => {
    const overlay = document.getElementById('confirm-overlay');
    const card = document.createElement('div');
    card.className = notFound ? 'confirm-card confirm-card--not-found' : 'confirm-card';
    
    const icon = TOOL_ICONS[toolName] || '⚙️';
    const cleanToolName = toolName.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
    
    card.innerHTML = `
      <div class="confirm-header">
        <div class="confirm-icon-wrapper ${notFound ? 'confirm-icon-wrapper--danger' : ''}">
          <span class="confirm-tool-icon">${icon}</span>
        </div>
        <div class="confirm-title-area">
          <div class="confirm-subtitle">${notFound ? 'WARNING' : 'CONFIRM ACTION'}</div>
          <div class="confirm-title">${escapeHtml(cleanToolName)} <span class="confirm-tool-badge">${escapeHtml(toolName)}</span></div>
        </div>
      </div>
      <div class="confirm-body">${escapeHtml(description)}</div>
      ${detail ? `<code class="confirm-detail">${escapeHtml(detail)}</code>` : ''}
      ${notFound
        ? `<div class="confirm-warning">⚠ Could not locate this element on the page — it may have changed. Confirm only if you understand the action.</div>`
        : `<div class="confirm-hint">The target is outlined in red on the page.${allowRetarget ? ' Wrong element? Use "Change target" to click the right one.' : ''}</div>`}
      <div class="confirm-actions">
        <button class="confirm-btn confirm-cancel">Cancel</button>
        ${allowRetarget ? '<button class="confirm-btn confirm-retarget" title="Pick a different element on the page for this action">🎯 Change target</button>' : ''}
        <button class="confirm-btn confirm-ok">Confirm</button>
      </div>
    `;

    let settled = false;
    let unsubscribe = () => {};
    const finish = (value) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      document.removeEventListener('keydown', onKey, true);
      card.remove();
      overlay.classList.add('hidden');
      resolve(value);
    };

    const okBtn = card.querySelector('.confirm-ok');
    okBtn.addEventListener('click', () => finish(true));
    card.querySelector('.confirm-cancel').addEventListener('click', () => finish(false));
    card.querySelector('.confirm-retarget')?.addEventListener('click', () => finish('retarget'));

    // Keyboard: Enter confirms, Escape cancels — so the user never has to "click
    // dumbly". Capture phase so it wins over page handlers.
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    document.addEventListener('keydown', onKey, true);

    // Pressing Stop while this modal is open must dismiss it and deny the action,
    // otherwise the agent stays parked forever inside the firewall's onAsk().
    if (abortHandle) {
      if (abortHandle.aborted) { finish(false); return; }
      unsubscribe = abortHandle.onAbort(() => finish(false));
    }

    overlay.innerHTML = '';
    overlay.appendChild(card);
    overlay.classList.remove('hidden');
    okBtn.focus();
  });

export const showToolActivity = (toolName, argsJson) => {
  const container = messagesEl();
  const icon = TOOL_ICONS[toolName] || '⚙️';
  const label = TOOL_LABELS[toolName] || toolName.replace(/([A-Z])/g, ' $1').trim().toLowerCase();

  let detail = '';
  try {
    const { url, selector, fields, direction, query } = JSON.parse(argsJson || '{}');
    if (url) detail = url;
    else if (query) detail = query;
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

export const updateAssistantMessage = (div, content) => {
  if (!div) return;
  
  // Strip out any goal verification warning text blocks injected by the Lemura runtime
  const warningRegex = /---\s*(?:⚠️|⚡|🚨|\u26A0\uFE0F)?\s*\*\*Goal Verification Warning\*\*[\s\S]*$/i;
  const cleanContent = content.replace(warningRegex, '').trim();

  const bodyEl = div.querySelector('.msg-body');
  if (bodyEl) {
    bodyEl.innerHTML = renderMarkdown(cleanContent);
  }
  
  // Remove any existing copy buttons to avoid duplication
  const oldCopyBtn = div.querySelector('.msg-copy-btn');
  if (oldCopyBtn) oldCopyBtn.remove();
  
  const msgContent = div.querySelector('.msg-content');
  if (msgContent) {
    msgContent.appendChild(makeCopyButton(cleanContent));
  }
  
  // Wire copy-code buttons
  div.querySelectorAll('.copy-code-btn').forEach(btn => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', async () => {
      const id = newBtn.dataset.target;
      const code = document.getElementById(id)?.textContent || '';
      await navigator.clipboard.writeText(code);
      const orig = newBtn.innerHTML;
      newBtn.textContent = 'Copied!';
      setTimeout(() => { newBtn.innerHTML = orig; }, 1800);
    });
  });
};

export const showVerificationEvent = (name, metadata) => {
  // Deduplicate retry events to keep the feed clean
  if (name === 'step_retry') {
    const existing = document.querySelector(`.trace-verification[data-step="${metadata?.stepId || ''}"]`);
    if (existing) existing.remove();
  }

  const container = messagesEl();
  const div = document.createElement('div');
  div.className = 'trace-verification';
  if (metadata?.stepId) {
    div.setAttribute('data-step', metadata.stepId);
  }
  let message = '';
  if (name === 'step_retry') {
    message = `🔄 Step ${metadata?.stepId || ''} retry #${metadata?.retryCount || 1}${metadata?.reason ? `: ${metadata.reason}` : ''}`;
  } else if (name === 'step_failed') {
    message = `❌ Step ${metadata?.stepId || ''} failed${metadata?.reason ? `: ${metadata.reason}` : ''}`;
  } else if (name === 'step_skipped') {
    message = `⏭️ Step ${metadata?.stepId || ''} skipped${metadata?.reason ? `: ${metadata.reason}` : ''}`;
  } else {
    message = `🔍 Verification: ${name}`;
  }
  div.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
};

export const getOrCreateVerificationContainer = () => {
  let el = document.getElementById('unified-goal-verifier');
  if (!el) {
    el = document.createElement('details');
    el.id = 'unified-goal-verifier';
    el.className = 'unified-goal-verifier';
    el.innerHTML = `
      <summary class="verifier-summary">
        <div class="verifier-summary-left">
          <span class="verifier-indicator-dot"></span>
          <span class="verifier-title">Goal Verification Status</span>
        </div>
        <div class="verifier-summary-right">
          <span id="verifier-status-badge" class="verifier-badge verifier-badge-pending">Running...</span>
          <svg class="verifier-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </summary>
      <div class="verifier-details-content">
        <ul id="verifier-log-list" class="verifier-log-list"></ul>
      </div>
    `;
    messagesEl().appendChild(el);
  }
  return el;
};

export const showGoalVerification = (status, reason) => {
  const container = getOrCreateVerificationContainer();
  
  const badge = container.querySelector('#verifier-status-badge');
  if (badge) {
    badge.className = `verifier-badge verifier-badge-${status === 'achieved' ? 'success' : 'failed'}`;
    badge.textContent = status === 'achieved' ? 'Goal Achieved' : 'Goal Failed';
  }
  
  const dot = container.querySelector('.verifier-indicator-dot');
  if (dot) {
    dot.style.background = status === 'achieved' ? '#10b981' : '#ef4444';
    dot.style.boxShadow = status === 'achieved' ? '0 0 8px #10b981' : '0 0 8px #ef4444';
    dot.style.animation = 'none';
  }

  const logList = container.querySelector('#verifier-log-list');
  if (logList) {
    const li = document.createElement('li');
    const icon = status === 'achieved' ? '✓' : '⚠️';
    const title = status === 'achieved' ? 'Goal Achieved' : 'Goal Verification Failed';
    li.innerHTML = `<strong>${icon} ${title}</strong>${reason ? `<div class="verifier-log-desc">${escapeHtml(reason)}</div>` : ''}`;
    logList.appendChild(li);
  }
  
  messagesEl().scrollTop = messagesEl().scrollHeight;
  return container;
};

export const showGoalCorrection = (name, metadata) => {
  const container = getOrCreateVerificationContainer();
  
  const badge = container.querySelector('#verifier-status-badge');
  const dot = container.querySelector('.verifier-indicator-dot');
  
  let msg = '';
  if (name === 'goal_correction_start') {
    msg = `🔧 Initiating goal correction loop: ${metadata?.missing || 'some criteria unmet'}`;
    if (badge) {
      badge.className = 'verifier-badge verifier-badge-correcting';
      badge.textContent = 'Correcting...';
    }
    if (dot) {
      dot.style.background = '#f59e0b';
      dot.style.boxShadow = '0 0 8px #f59e0b';
    }
  } else if (name === 'goal_correction_done') {
    msg = `✅ Goal correction applied. Running final verification...`;
    if (badge) {
      badge.className = 'verifier-badge verifier-badge-pending';
      badge.textContent = 'Verifying...';
    }
    if (dot) {
      dot.style.background = '#a855f7';
      dot.style.boxShadow = '0 0 8px #a855f7';
    }
  } else if (name === 'goal_correction_failed') {
    msg = `⚠️ Goal correction failed to satisfy all criteria.`;
    if (badge) {
      badge.className = 'verifier-badge verifier-badge-failed';
      badge.textContent = 'Failed';
    }
    if (dot) {
      dot.style.background = '#ef4444';
      dot.style.boxShadow = '0 0 8px #ef4444';
    }
  } else {
    msg = `🔧 Goal correction: ${name}`;
  }

  const logList = container.querySelector('#verifier-log-list');
  if (logList) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(msg)}</span>`;
    logList.appendChild(li);
  }
  
  messagesEl().scrollTop = messagesEl().scrollHeight;
  return container;
};

export const updateCognitiveStats = (stats) => {
  const statTurns = document.getElementById('stat-turns');
  const statToolCalls = document.getElementById('stat-tool-calls');
  const statSteps = document.getElementById('stat-steps');
  const statInputTokens = document.getElementById('stat-input-tokens');
  const statOutputTokens = document.getElementById('stat-output-tokens');
  const statBudgetPercentage = document.getElementById('stat-budget-percentage');
  const statProgressBar = document.getElementById('stat-progress-bar');
  const statCurrentTokens = document.getElementById('stat-current-tokens');
  const statMaxTokens = document.getElementById('stat-max-tokens');
  const triggerPercentage = document.querySelector('.stats-percentage');

  if (statTurns) statTurns.textContent = stats.turns;
  if (statToolCalls) statToolCalls.textContent = stats.activeToolCalls;
  
  const remainingSteps = Math.max(0, stats.maxSteps - stats.steps);
  if (statSteps) statSteps.textContent = `${stats.steps} / ${stats.maxSteps} (${remainingSteps} remaining)`;
  
  if (statInputTokens) statInputTokens.textContent = stats.inputTokens.toLocaleString();
  if (statOutputTokens) statOutputTokens.textContent = stats.outputTokens.toLocaleString();
  
  const totalUsed = stats.inputTokens + stats.outputTokens;
  const maxTokens = stats.maxTokens || 16000;
  const percentage = Math.min(100, Math.round((totalUsed / maxTokens) * 100));
  
  if (statBudgetPercentage) statBudgetPercentage.textContent = `${percentage}%`;
  if (triggerPercentage) triggerPercentage.textContent = `${percentage}%`;
  if (statProgressBar) statProgressBar.style.width = `${percentage}%`;
  if (statCurrentTokens) statCurrentTokens.textContent = totalUsed.toLocaleString();
  if (statMaxTokens) statMaxTokens.textContent = `${maxTokens.toLocaleString()} max`;
};

export const resetCognitiveStats = (maxSteps = 30, maxTokens = 16000) => {
  updateCognitiveStats({
    turns: 0,
    activeToolCalls: 0,
    steps: 0,
    maxSteps,
    inputTokens: 0,
    outputTokens: 0,
    maxTokens
  });
};

export const setSendButtonState = (running) => {
  const btn = document.getElementById('btn-send');
  if (!btn) return;
  
  if (running) {
    btn.classList.add('btn-stop-state');
    btn.setAttribute('title', 'Stop agent');
    btn.innerHTML = `
      <svg class="stop-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
        <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
      </svg>
    `;
  } else {
    btn.classList.remove('btn-stop-state');
    btn.setAttribute('title', 'Send (Enter)');
    btn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    `;
  }
};
