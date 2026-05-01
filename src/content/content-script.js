// DOM execution layer — runs inside the active tab's page context.
// All browser tool actions are dispatched here from the sidebar.

const MAX_TEXT_LENGTH = 15000;
const MAX_HTML_LENGTH = 30000;

const handlers = {
  GET_PAGE_CONTENT({ maxLength = MAX_TEXT_LENGTH } = {}) {
    const text = (document.body?.innerText || '').slice(0, maxLength);
    return {
      title: document.title,
      url: location.href,
      text,
      truncated: (document.body?.innerText || '').length > maxLength
    };
  },

  GET_PAGE_HTML({ maxLength = MAX_HTML_LENGTH } = {}) {
    const html = document.documentElement.outerHTML.slice(0, maxLength);
    return { html, title: document.title, url: location.href };
  },

  GET_SELECTED_TEXT() {
    return { text: window.getSelection()?.toString() || '' };
  },

  GET_META() {
    const getMeta = (name) =>
      document.querySelector(`meta[name="${name}"]`)?.content ||
      document.querySelector(`meta[property="${name}"]`)?.content || '';
    return {
      title: document.title,
      url: location.href,
      description: getMeta('description') || getMeta('og:description'),
      ogTitle: getMeta('og:title'),
      ogImage: getMeta('og:image'),
      canonical: document.querySelector('link[rel="canonical"]')?.href || '',
      lang: document.documentElement.lang || ''
    };
  },

  EXTRACT_LINKS({ selector = 'body', limit = 50 } = {}) {
    const root = selector ? document.querySelector(selector) : document.body;
    if (!root) return { links: [], error: `Selector not found: ${selector}` };
    const anchors = Array.from(root.querySelectorAll('a[href]')).slice(0, limit);
    const links = anchors.map(a => ({
      text: a.innerText.trim().slice(0, 120),
      href: a.href,
      title: a.title || ''
    })).filter(l => l.href && !l.href.startsWith('javascript:'));
    return { links };
  },

  EXTRACT_TABLE({ selector } = {}) {
    const table = document.querySelector(selector);
    if (!table) return { rows: [], error: `Table not found: ${selector}` };
    const rows = Array.from(table.querySelectorAll('tr')).map(tr =>
      Array.from(tr.querySelectorAll('th,td')).map(cell => cell.innerText.trim())
    );
    return { rows };
  },

  async CLICK_ELEMENT({ selector, waitAfterMs = 500 } = {}) {
    const el = document.querySelector(selector);
    if (!el) return { success: false, error: `Element not found: ${selector}` };
    el.click();
    await new Promise(r => setTimeout(r, waitAfterMs));
    return { success: true, clicked: el.innerText?.trim().slice(0, 80) || el.tagName };
  },

  FILL_FORM({ fields = [] } = {}) {
    const results = [];
    for (const { selector, value } of fields) {
      const el = document.querySelector(selector);
      if (!el) { results.push({ selector, success: false, error: 'Not found' }); continue; }

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, value);
      } else {
        el.value = value;
      }

      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      results.push({ selector, success: true });
    }
    return { filled: results.filter(r => r.success).length, results };
  },

  SUBMIT_FORM({ selector } = {}) {
    const el = document.querySelector(selector);
    if (!el) return { success: false, error: `Element not found: ${selector}` };
    const form = el.tagName === 'FORM' ? el : el.closest('form');
    if (form) {
      const submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) { submitBtn.click(); return { success: true, method: 'submit-button' }; }
      form.submit();
      return { success: true, method: 'form-submit' };
    }
    // Might be a submit button itself
    el.click();
    return { success: true, method: 'click' };
  },

  SCROLL_PAGE({ direction = 'down', amount = 500, selector } = {}) {
    if (selector) {
      const el = document.querySelector(selector);
      if (!el) return { success: false, error: `Element not found: ${selector}` };
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return { success: true, method: 'scrollIntoView' };
    }
    const scrollMap = {
      down: () => window.scrollBy(0, amount),
      up: () => window.scrollBy(0, -amount),
      top: () => window.scrollTo(0, 0),
      bottom: () => window.scrollTo(0, document.body.scrollHeight)
    };
    (scrollMap[direction] || scrollMap.down)();
    return { success: true, direction, amount };
  },

  HIGHLIGHT_ELEMENT({ selector, color = '#ff6b35' } = {}) {
    const el = document.querySelector(selector);
    if (!el) return { success: false, error: `Element not found: ${selector}` };
    const prev = el.style.outline;
    el.style.outline = `3px solid ${color}`;
    setTimeout(() => { el.style.outline = prev; }, 2500);
    return { success: true };
  },

  async SCROLL_AND_READ({ scrolls = 3, waitMs = 1200, maxLength = 12000 } = {}) {
    const textBefore = document.body?.innerText || '';
    for (let i = 0; i < scrolls; i++) {
      window.scrollBy(0, window.innerHeight * 0.85);
      await new Promise(r => setTimeout(r, waitMs));
    }
    const textAfter = (document.body?.innerText || '').slice(0, maxLength);
    return {
      title: document.title,
      url: location.href,
      text: textAfter,
      truncated: (document.body?.innerText || '').length > maxLength,
      newContentLoaded: textAfter.length > textBefore.length
    };
  },

  WAIT_FOR_ELEMENT({ selector, timeoutMs = 5000 } = {}) {
    return new Promise((resolve) => {
      if (document.querySelector(selector)) {
        return resolve({ found: true, elapsed: 0 });
      }
      const start = Date.now();
      const observer = new MutationObserver(() => {
        if (document.querySelector(selector)) {
          observer.disconnect();
          resolve({ found: true, elapsed: Date.now() - start });
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve({ found: false, elapsed: timeoutMs });
      }, timeoutMs);
    });
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { action, ...params } = message;
  const handler = handlers[action];

  if (!handler) {
    sendResponse({ success: false, error: `Unknown action: ${action}` });
    return false;
  }

  Promise.resolve()
    .then(() => handler(params))
    .then(data => sendResponse({ success: true, data }))
    .catch(err => sendResponse({ success: false, error: err.message }));

  return true; // keep message channel open for async response
});
