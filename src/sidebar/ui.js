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
