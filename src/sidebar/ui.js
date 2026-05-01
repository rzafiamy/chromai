const messagesEl = () => document.getElementById('messages');
const toolStatusEl = () => document.getElementById('tool-status');
const typingEl = () => document.getElementById('typing-indicator');

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Very light markdown: bold, inline code, code blocks, line breaks
function renderMarkdown(text) {
  // Code blocks
  text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
    `<pre><code>${escapeHtml(code.trim())}</code></pre>`
  );
  // Inline code
  text = text.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Line breaks
  text = text.replace(/\n/g, '<br>');
  return text;
}

export function renderMessage(role, content) {
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
}

export function showTyping() {
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
}

export function hideTyping() {
  const el = typingEl();
  if (el) el.remove();
}

/**
 * Show a confirmation card in the sidebar.
 * Resolves true (confirm) or false (cancel).
 * Only one confirm card can be active at a time.
 */
export function showConfirm({ toolName, description, detail }) {
  return new Promise((resolve) => {
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

    card.querySelector('.confirm-ok').addEventListener('click', () => {
      card.remove();
      resolve(true);
    });
    card.querySelector('.confirm-cancel').addEventListener('click', () => {
      card.remove();
      resolve(false);
    });

    container.appendChild(card);
    container.scrollTop = container.scrollHeight;
  });
}

export function showToolStatus(label) {
  const el = toolStatusEl();
  if (el) {
    el.textContent = `⚙ ${label}`;
    el.classList.remove('hidden');
  }
}

export function hideToolStatus() {
  const el = toolStatusEl();
  if (el) el.classList.add('hidden');
}
