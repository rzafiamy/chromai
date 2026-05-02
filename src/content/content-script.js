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

  GET_INTERACTIVE_ELEMENTS({ includeHidden = false } = {}) {
    const INTERACTIVE = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [tabindex]';

    function resolveLabel(el) {
      // 1. explicit <label for="id">
      if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl) return lbl.innerText.trim().slice(0, 80);
      }
      // 2. wrapping <label>
      const wrapLabel = el.closest('label');
      if (wrapLabel) return wrapLabel.innerText.trim().slice(0, 80);
      // 3. aria attributes
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').slice(0, 80);
      if (el.getAttribute('aria-labelledby')) {
        const ref = document.getElementById(el.getAttribute('aria-labelledby'));
        if (ref) return ref.innerText.trim().slice(0, 80);
      }
      // 4. placeholder / title / name
      return (el.placeholder || el.title || el.name || el.innerText?.trim() || '').slice(0, 80);
    }

    function uniqueSelector(el) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.getAttribute('name')) return `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;
      if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
      // Walk up and build nth-of-type path (max 4 levels)
      const parts = [];
      let node = el;
      for (let i = 0; i < 4 && node && node !== document.body; i++) {
        const tag = node.tagName.toLowerCase();
        const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName) : [];
        const idx = siblings.indexOf(node) + 1;
        parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
        node = node.parentElement;
      }
      return parts.join(' > ');
    }

    function rect(el) {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }

    const elements = Array.from(document.querySelectorAll(INTERACTIVE))
      .filter(el => {
        if (!includeHidden) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        }
        return true;
      })
      .slice(0, 120)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || el.getAttribute('role') || null,
        selector: uniqueSelector(el),
        label: resolveLabel(el),
        value: el.value !== undefined ? String(el.value).slice(0, 200) : null,
        checked: el.checked !== undefined ? el.checked : null,
        disabled: el.disabled || null,
        placeholder: el.placeholder || null,
        href: el.href || null,
        position: rect(el)
      }));

    return { count: elements.length, elements };
  },

  GET_FORMS() {
    function resolveLabel(el) {
      if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl) return lbl.innerText.trim().slice(0, 80);
      }
      const wrapLabel = el.closest('label');
      if (wrapLabel) return wrapLabel.innerText.trim().slice(0, 80);
      return (el.getAttribute('aria-label') || el.placeholder || el.name || '').slice(0, 80);
    }

    function uniqueSelector(el) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.getAttribute('name')) return `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;
      const parts = [];
      let node = el;
      for (let i = 0; i < 4 && node && node !== document.body; i++) {
        const tag = node.tagName.toLowerCase();
        const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName) : [];
        const idx = siblings.indexOf(node) + 1;
        parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
        node = node.parentElement;
      }
      return parts.join(' > ');
    }

    const forms = Array.from(document.querySelectorAll('form')).map((form, fi) => {
      const formSelector = form.id ? `#${CSS.escape(form.id)}` : `form:nth-of-type(${fi + 1})`;
      const fields = Array.from(form.querySelectorAll('input, select, textarea, button')).map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        selector: uniqueSelector(el),
        label: resolveLabel(el),
        value: el.value !== undefined ? String(el.value).slice(0, 200) : null,
        placeholder: el.placeholder || null,
        required: el.required || null,
        disabled: el.disabled || null
      }));
      return {
        selector: formSelector,
        action: form.action || null,
        method: form.method || 'get',
        fields
      };
    });

    // Also surface inputs that are NOT inside a <form> (common in SPAs)
    const orphanInputs = Array.from(document.querySelectorAll('input, select, textarea'))
      .filter(el => !el.closest('form'))
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        selector: uniqueSelector(el),
        label: resolveLabel(el),
        value: el.value !== undefined ? String(el.value).slice(0, 200) : null,
        placeholder: el.placeholder || null,
        required: el.required || null,
        disabled: el.disabled || null
      }));

    return { forms, orphanInputs };
  },

  GET_PAGE_CONTEXT({ textLength = 4000, maxElements = 40 } = {}) {
    // Compact DOM structure: headings + landmark roles to give shape without noise
    function domSummary() {
      const landmarks = Array.from(document.querySelectorAll(
        'h1,h2,h3,nav,main,header,footer,aside,section,article,[role="main"],[role="navigation"],[role="search"]'
      )).slice(0, 30).map(el => {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || '';
        const text = (el.innerText || '').trim().slice(0, 60).replace(/\s+/g, ' ');
        return `<${tag}${role ? ` role="${role}"` : ''}>${text ? ` "${text}"` : ''}`;
      });
      return landmarks.join('\n');
    }

    // Key interactive elements with selectors — same logic as GET_INTERACTIVE_ELEMENTS but compact
    const INTERACTIVE = 'button, input:not([type=hidden]), select, textarea, a[href], [role="button"], [role="tab"], [role="menuitem"]';

    function resolveLabel(el) {
      if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl) return lbl.innerText.trim().slice(0, 60);
      }
      const wrapLabel = el.closest('label');
      if (wrapLabel) return wrapLabel.innerText.trim().slice(0, 60);
      return (el.getAttribute('aria-label') || el.placeholder || el.title || el.name || el.innerText?.trim() || '').slice(0, 60);
    }

    function uniqueSelector(el) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.getAttribute('name')) return `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;
      if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
      const parts = [];
      let node = el;
      for (let i = 0; i < 4 && node && node !== document.body; i++) {
        const tag = node.tagName.toLowerCase();
        const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName) : [];
        const idx = siblings.indexOf(node) + 1;
        parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
        node = node.parentElement;
      }
      return parts.join(' > ');
    }

    const elements = Array.from(document.querySelectorAll(INTERACTIVE))
      .filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      })
      .slice(0, maxElements)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || el.getAttribute('role') || null,
        selector: uniqueSelector(el),
        label: resolveLabel(el),
        value: el.value !== undefined && el.value ? String(el.value).slice(0, 80) : null
      }));

    return {
      url: location.href,
      title: document.title,
      text: (document.body?.innerText || '').slice(0, textLength),
      textTruncated: (document.body?.innerText || '').length > textLength,
      domSummary: domSummary(),
      interactiveElements: elements
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
