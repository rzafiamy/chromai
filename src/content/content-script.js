// DOM execution layer — runs inside the active tab's page context.
// All browser tool actions are dispatched here from the sidebar.

const MAX_TEXT_LENGTH = 15000;
const MAX_HTML_LENGTH = 30000;

const handlers = {
  GET_PAGE_CONTENT({ maxLength = MAX_TEXT_LENGTH, rootSelector } = {}) {
    const root = rootSelector ? document.querySelector(rootSelector) : document.body;
    if (rootSelector && !root) return { error: `Selector not found: ${rootSelector}` };
    const rawText = root?.innerText || '';
    const text = rawText.slice(0, maxLength);
    return {
      title: document.title,
      url: location.href,
      rootSelector: rootSelector || null,
      text,
      truncated: rawText.length > maxLength
    };
  },

  GET_PAGE_HTML({ maxLength = MAX_HTML_LENGTH, rootSelector } = {}) {
    const root = rootSelector ? document.querySelector(rootSelector) : document.documentElement;
    if (rootSelector && !root) return { error: `Selector not found: ${rootSelector}` };
    const html = (root?.outerHTML || '').slice(0, maxLength);
    return { html, title: document.title, url: location.href, rootSelector: rootSelector || null };
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

    el.focus();

    // Fire a full pointer event sequence so React/Vue synthetic handlers fire
    const rect = el.getBoundingClientRect();
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);
    const pointerOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };

    el.dispatchEvent(new PointerEvent('pointerover', pointerOpts));
    el.dispatchEvent(new MouseEvent('mouseover', pointerOpts));
    el.dispatchEvent(new PointerEvent('pointerenter', { ...pointerOpts, bubbles: false }));
    el.dispatchEvent(new MouseEvent('mouseenter', { ...pointerOpts, bubbles: false }));
    el.dispatchEvent(new PointerEvent('pointermove', pointerOpts));
    el.dispatchEvent(new MouseEvent('mousemove', pointerOpts));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...pointerOpts, button: 0, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...pointerOpts, button: 0, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...pointerOpts, button: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...pointerOpts, button: 0 }));
    el.click(); // native click as final step

    await new Promise(r => setTimeout(r, waitAfterMs));
    return { success: true, clicked: el.innerText?.trim().slice(0, 80) || el.tagName };
  },

  FILL_FORM({ fields = [] } = {}) {
    function fillOne(el, value) {
      el.focus();

      // contenteditable (Grok, Twitter, Notion, …)
      if (el.isContentEditable) {
        el.innerHTML = '';
        document.execCommand('insertText', false, value);
        if (!el.textContent.includes(value)) {
          // execCommand not supported — set innerText and fire events manually
          el.innerText = value;
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      // Standard input / textarea
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    const results = [];
    for (const { selector, value } of fields) {
      const el = document.querySelector(selector);
      if (!el) { results.push({ selector, success: false, error: 'Not found' }); continue; }
      try {
        fillOne(el, value);
        results.push({ selector, success: true });
      } catch (e) {
        results.push({ selector, success: false, error: e.message });
      }
    }
    return { filled: results.filter(r => r.success).length, results };
  },

  SUBMIT_FORM({ selector } = {}) {
    const el = document.querySelector(selector);
    if (!el) return { success: false, error: `Element not found: ${selector}` };

    // 1. Explicit <form> submit
    const form = el.tagName === 'FORM' ? el : el.closest('form');
    if (form) {
      const submitBtn = form.querySelector('[type="submit"]:not([disabled])');
      if (submitBtn) { submitBtn.click(); return { success: true, method: 'submit-button' }; }
      form.requestSubmit?.() ?? form.submit();
      return { success: true, method: 'form-submit' };
    }

    // 2. Visible submit / send button near the element
    const submitCandidates = [
      ...document.querySelectorAll('button[type="submit"], button[aria-label*="Send" i], button[aria-label*="Submit" i], button[aria-label*="Envoyer" i], button[data-testid*="send" i], button[data-testid*="submit" i]')
    ].filter(b => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !b.disabled;
    });
    if (submitCandidates.length > 0) {
      submitCandidates[0].click();
      return { success: true, method: 'submit-button-nearby', selector: submitCandidates[0].getAttribute('aria-label') || submitCandidates[0].textContent.trim().slice(0, 40) };
    }

    // 3. Enter keydown on the element (SPA pattern — Grok, ChatGPT, etc.)
    const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    el.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
    el.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
    return { success: true, method: 'enter-keydown' };
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
    const INTERACTIVE = 'a[href], button, input, select, textarea, [contenteditable], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="textbox"], [role="combobox"], [tabindex]';

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

  GET_PAGE_CONTEXT({ textLength = 4000, maxElements = 40, rootSelector } = {}) {
    const root = rootSelector ? document.querySelector(rootSelector) : null;
    if (rootSelector && !root) return { error: `Focus region not found: ${rootSelector}` };
    const textRoot = root || document.body;

    // Compact DOM structure: headings + landmark roles to give shape without noise
    function domSummary() {
      const landmarks = Array.from((root || document).querySelectorAll(
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
    const INTERACTIVE = 'button, input:not([type=hidden]), select, textarea, [contenteditable], a[href], [role="button"], [role="tab"], [role="menuitem"], [role="textbox"], [role="combobox"]';

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

    const elements = Array.from((root || document).querySelectorAll(INTERACTIVE))
      .filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      })
      .slice(0, maxElements)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.isContentEditable ? 'contenteditable' : (el.type || el.getAttribute('role') || null),
        selector: uniqueSelector(el),
        label: resolveLabel(el),
        value: el.isContentEditable
          ? (el.innerText?.trim().slice(0, 80) || null)
          : (el.value !== undefined && el.value ? String(el.value).slice(0, 80) : null)
      }));

    const rawText = textRoot?.innerText || '';
    return {
      url: location.href,
      title: document.title,
      focusRegion: rootSelector || null,
      text: rawText.slice(0, textLength),
      textTruncated: rawText.length > textLength,
      domSummary: domSummary(),
      interactiveElements: elements
    };
  },

  async TYPE_TEXT({ selector, text, clearFirst = false, pressEnter = false } = {}) {
    const el = document.querySelector(selector);
    if (!el) return { success: false, error: `Element not found: ${selector}` };
    el.focus();

    const isContentEditable = el.isContentEditable;

    if (clearFirst) {
      if (isContentEditable) {
        el.innerHTML = '';
      } else {
        const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, '');
        else el.value = '';
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }

    if (isContentEditable) {
      // Use execCommand for contenteditable — fires all the right internal events
      // that React/Vue listen to via their synthetic event system
      const inserted = document.execCommand('insertText', false, text);
      if (!inserted) {
        // Fallback: set innerText and dispatch manually
        el.innerText = (el.innerText || '') + text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      }
    } else {
      // Standard input/textarea: type char by char so React state updates on each keystroke
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      for (const char of text) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
        const next = el.value + char;
        if (setter) setter.call(el, next);
        else el.value = next;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      }
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));

    if (pressEnter) {
      const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
      el.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
      el.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
    }

    const finalValue = isContentEditable ? el.innerText.slice(0, 200) : el.value.slice(0, 200);
    return { success: true, typed: text.length, value: finalValue };
  },

  PRESS_KEY({ selector, key, modifiers = [] } = {}) {
    const target = selector ? document.querySelector(selector) : document.activeElement;
    if (selector && !target) return { success: false, error: `Element not found: ${selector}` };
    const opts = {
      key,
      code: key,
      bubbles: true,
      ctrlKey: modifiers.includes('ctrl'),
      shiftKey: modifiers.includes('shift'),
      altKey: modifiers.includes('alt'),
      metaKey: modifiers.includes('meta')
    };
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
    return { success: true, key, target: target.tagName };
  },

  GET_ELEMENT_RECT({ selector } = {}) {
    const el = document.querySelector(selector);
    if (!el) return { success: false, error: `Element not found: ${selector}` };
    const r = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      success: true,
      selector,
      rect: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
        devicePixelRatio: dpr,
        // Physical pixel coords for screenshot cropping
        px: Math.round(r.x * dpr),
        py: Math.round(r.y * dpr),
        pw: Math.round(r.width * dpr),
        ph: Math.round(r.height * dpr)
      }
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

// ── Element picker (inspector mode) ──────────────────────────────────────────

let _pickerActive = false;
let _pickerOverlay = null;
let _pickerHovered = null;

function _pickerSelector(el) {
  const isUnique = (sel) => document.querySelectorAll(sel).length === 1;

  // Build a segment for one node: prefer data attrs and id, fall back to tag+classes+nth
  function nodeSegment(node, requireNth = false) {
    if (node.id) return `#${CSS.escape(node.id)}`;
    const testid = node.getAttribute('data-testid') || node.getAttribute('data-test-id') || node.getAttribute('data-cy');
    const tag = node.tagName.toLowerCase();
    const classes = Array.from(node.classList)
      .filter(c => !/^(js-|is-|has-|ng-|v-|svelte-|css-|sc-)/.test(c) && c.length < 30)
      .slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
    const siblings = node.parentElement
      ? Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName)
      : [];
    const nth = siblings.length > 1 || requireNth ? `:nth-of-type(${siblings.indexOf(node) + 1})` : '';
    if (testid) return `[data-testid="${CSS.escape(testid)}"]${nth}`;
    return `${tag}${classes}${nth}`;
  }

  // Walk up building a path, stopping as soon as it's unique in the DOM
  const parts = [];
  let node = el;
  for (let i = 0; i < 10 && node && node !== document.documentElement; i++, node = node.parentElement) {
    const seg = nodeSegment(node, i === 0 && false);
    parts.unshift(seg);
    const sel = parts.join(' > ');
    if (isUnique(sel)) return sel;
    // If we've anchored on an id, the path will never get more unique — bail
    if (seg.startsWith('#')) break;
  }

  // Last resort: use the full built path even if not unique
  return parts.join(' > ');
}

function _enterPickMode() {
  if (_pickerActive) return;
  _pickerActive = true;

  _pickerOverlay = document.createElement('div');
  Object.assign(_pickerOverlay.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
    border: '2px solid #6366f1', borderRadius: '3px',
    background: 'rgba(99,102,241,0.08)', transition: 'all 0.08s ease',
    boxShadow: '0 0 0 1px rgba(99,102,241,0.4)',
    display: 'none'
  });

  const _pickerLabel = document.createElement('div');
  Object.assign(_pickerLabel.style, {
    position: 'absolute', bottom: '100%', left: '0', marginBottom: '4px',
    background: '#6366f1', color: '#fff', fontSize: '11px', fontFamily: 'monospace',
    padding: '2px 6px', borderRadius: '3px', whiteSpace: 'nowrap',
    pointerEvents: 'none', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis'
  });
  _pickerOverlay.appendChild(_pickerLabel);
  document.documentElement.appendChild(_pickerOverlay);

  document.documentElement.style.cursor = 'crosshair';

  const onMove = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === _pickerOverlay) return;
    _pickerHovered = el;
    const r = el.getBoundingClientRect();
    Object.assign(_pickerOverlay.style, {
      display: 'block',
      top: `${r.top}px`, left: `${r.left}px`,
      width: `${r.width}px`, height: `${r.height}px`
    });
    _pickerLabel.textContent = _pickerSelector(el);
  };

  const onClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!_pickerHovered) return;
    const selector = _pickerSelector(_pickerHovered);
    _exitPickMode();
    chrome.runtime.sendMessage({ action: 'REGION_PICKED', selector });
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { _exitPickMode(); chrome.runtime.sendMessage({ action: 'REGION_PICK_CANCELLED' }); }
  };

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);

  // Store cleanup refs on the overlay element
  _pickerOverlay._cleanup = () => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
  };
}

function _exitPickMode() {
  if (!_pickerActive) return;
  _pickerActive = false;
  document.documentElement.style.cursor = '';
  if (_pickerOverlay) {
    _pickerOverlay._cleanup?.();
    _pickerOverlay.remove();
    _pickerOverlay = null;
  }
  _pickerHovered = null;
}

// ── Persistent region highlight ───────────────────────────────────────────────

let _regionHighlight = null;
let _regionHighlightSelector = null;
let _regionHighlightObs = null;

function _showRegionHighlight(selector) {
  _clearRegionHighlight();
  const el = selector ? document.querySelector(selector) : null;
  if (!el) return;

  _regionHighlightSelector = selector;

  const badge = document.createElement('div');
  Object.assign(badge.style, {
    position: 'absolute', top: '0', left: '0',
    background: '#6366f1', color: '#fff', fontSize: '10px', fontFamily: 'monospace',
    padding: '1px 5px', borderRadius: '0 0 4px 0', pointerEvents: 'none',
    whiteSpace: 'nowrap', maxWidth: '240px',
    overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '16px'
  });
  badge.textContent = selector;

  // Use fixed positioning — matches the picker overlay and requires no scroll math
  _regionHighlight = document.createElement('div');
  Object.assign(_regionHighlight.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
    border: '2px solid #6366f1', borderRadius: '3px',
    background: 'rgba(99,102,241,0.08)',
    boxShadow: '0 0 0 1px rgba(99,102,241,0.4)',
  });
  _regionHighlight.appendChild(badge);
  document.documentElement.appendChild(_regionHighlight);

  function reposition() {
    const r = el.getBoundingClientRect();
    Object.assign(_regionHighlight.style, {
      top: `${r.top}px`,
      left: `${r.left}px`,
      width: `${r.width}px`,
      height: `${r.height}px`
    });
  }

  reposition();

  _regionHighlightObs = new ResizeObserver(reposition);
  _regionHighlightObs.observe(el);
  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition, { passive: true });
  _regionHighlight._teardown = () => {
    _regionHighlightObs?.disconnect();
    window.removeEventListener('scroll', reposition);
    window.removeEventListener('resize', reposition);
  };
}

function _clearRegionHighlight() {
  if (_regionHighlight) {
    _regionHighlight._teardown?.();
    _regionHighlight.remove();
    _regionHighlight = null;
  }
  _regionHighlightObs = null;
  _regionHighlightSelector = null;
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { action, ...params } = message;

  if (action === 'ENTER_PICK_MODE')       { _enterPickMode(); sendResponse({ success: true }); return false; }
  if (action === 'EXIT_PICK_MODE')        { _exitPickMode();  sendResponse({ success: true }); return false; }
  if (action === 'HIGHLIGHT_REGION')      { _showRegionHighlight(params.selector); sendResponse({ success: true }); return false; }
  if (action === 'CLEAR_REGION_HIGHLIGHT'){ _clearRegionHighlight(); sendResponse({ success: true }); return false; }

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
