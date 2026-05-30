// DOM execution layer — runs inside the active tab's page context.
// All browser tool actions are dispatched here from the sidebar.

const MAX_TEXT_LENGTH = 15000;
const MAX_HTML_LENGTH = 30000;

// Traverse Shadow DOM boundaries. LinkedIn and other SPAs render modals and
// interactive elements inside shadow roots that are invisible to querySelector.
function querySelectorDeep(selector, root = document) {
  const found = root.querySelector(selector);
  if (found) return found;
  const all = root.querySelectorAll('*');
  for (const el of all) {
    if (el.shadowRoot) {
      const deep = querySelectorDeep(selector, el.shadowRoot);
      if (deep) return deep;
    }
  }
  return null;
}

function querySelectorAllDeep(selector, root = document) {
  const results = Array.from(root.querySelectorAll(selector));
  const all = root.querySelectorAll('*');
  for (const el of all) {
    if (el.shadowRoot) {
      results.push(...querySelectorAllDeep(selector, el.shadowRoot));
    }
  }
  return results;
}

// ── Shared element helpers ────────────────────────────────────────────────────
// Centralized so every tool (interactive elements, forms, page context, action
// button finder) produces the SAME stable selectors and accessible names. This
// is what makes the agent reliable on SPAs like LinkedIn and Facebook, where
// class names are hashed and structure changes on every render.

// Accessible name resolution, roughly following the ARIA accname algorithm:
// aria-label → aria-labelledby → associated <label> → placeholder/title/value
// → trimmed text content. This is the label the agent should reason about.
function accessibleName(el) {
  if (!el) return '';
  const aria = el.getAttribute?.('aria-label');
  if (aria?.trim()) return aria.trim().slice(0, 100);

  const labelledby = el.getAttribute?.('aria-labelledby');
  if (labelledby) {
    const text = labelledby.split(/\s+/)
      .map(id => document.getElementById(id)?.innerText?.trim())
      .filter(Boolean).join(' ');
    if (text) return text.slice(0, 100);
  }
  if (el.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl?.innerText?.trim()) return lbl.innerText.trim().slice(0, 100);
  }
  const wrapLabel = el.closest?.('label');
  if (wrapLabel?.innerText?.trim()) return wrapLabel.innerText.trim().slice(0, 100);

  const titled = el.getAttribute?.('title') || el.placeholder || el.getAttribute?.('data-placeholder');
  if (titled?.trim?.()) return titled.trim().slice(0, 100);

  // Image-only buttons: fall back to alt text of a child image/svg title
  const img = el.querySelector?.('img[alt]');
  if (img?.alt?.trim()) return img.alt.trim().slice(0, 100);

  const txt = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
  return txt.slice(0, 100);
}

// Is this element actually visible and on-screen?
function isVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const s = getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
}

// Class tokens that are framework-generated and unstable — never anchor on these.
const UNSTABLE_CLASS = /^(js-|is-|has-|ng-|v-|svelte-|css-|sc-|jsx-|emotion-|MuiBox|chakra-)|[a-z0-9]{6,}$/i;

function stableClasses(el) {
  return Array.from(el.classList || [])
    .filter(c => c.length < 30 && !UNSTABLE_CLASS.test(c))
    .slice(0, 2);
}

// Build the most stable CSS selector we can for an element, preferring handles
// that survive re-renders: id → data-testid/data-* → name → aria-label → role+
// stable-class, validated for uniqueness, falling back to an nth-of-type path.
function buildSelector(el) {
  if (!el || el.nodeType !== 1) return null;
  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } };

  if (el.id && !/^[0-9]/.test(el.id)) {
    const sel = `#${CSS.escape(el.id)}`;
    if (unique(sel)) return sel;
  }
  for (const attr of ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-control-name', 'data-tracking-control-name']) {
    const v = el.getAttribute?.(attr);
    if (v) {
      const sel = `[${attr}="${CSS.escape(v)}"]`;
      if (unique(sel)) return sel;
    }
  }
  const name = el.getAttribute?.('name');
  if (name) {
    const sel = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    if (unique(sel)) return sel;
  }
  const aria = el.getAttribute?.('aria-label');
  if (aria) {
    const sel = `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(aria)}"]`;
    if (unique(sel)) return sel;
    // aria-label scoped by role is often unique even when label alone isn't
    const role = el.getAttribute('role');
    if (role) {
      const roleSel = `[role="${role}"][aria-label="${CSS.escape(aria)}"]`;
      if (unique(roleSel)) return roleSel;
    }
  }

  // Walk up building a path, anchoring on stable handles, stopping once unique.
  const segment = (node) => {
    const tag = node.tagName.toLowerCase();
    const testid = node.getAttribute?.('data-testid') || node.getAttribute?.('data-control-name');
    if (testid) return `[data-testid="${CSS.escape(testid)}"]`;
    const cls = stableClasses(node).map(c => `.${CSS.escape(c)}`).join('');
    const siblings = node.parentElement
      ? Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName)
      : [];
    const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : '';
    return `${tag}${cls}${nth}`;
  };

  const parts = [];
  let node = el;
  for (let i = 0; i < 6 && node && node !== document.body && node.nodeType === 1; i++) {
    parts.unshift(segment(node));
    const sel = parts.join(' > ');
    if (unique(sel)) return sel;
    node = node.parentElement;
  }
  return parts.join(' > ');
}

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
    const el = querySelectorDeep(selector);
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
      const el = querySelectorDeep(selector);
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
    const el = querySelectorDeep(selector);
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
      const el = querySelectorDeep(selector);
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
    const el = querySelectorDeep(selector);
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
    const INTERACTIVE = 'a[href], button, input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="textbox"], [role="combobox"], [role="switch"], [role="option"], [onclick], [tabindex]:not([tabindex="-1"])';

    function rect(el) {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }

    // Traverse shadow DOM — LinkedIn/Facebook render interactive UI inside roots.
    const raw = querySelectorAllDeep(INTERACTIVE);
    const seen = new Set();
    const elements = raw
      .filter(el => {
        if (seen.has(el)) return false;
        seen.add(el);
        return includeHidden || isVisible(el);
      })
      .slice(0, 140)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.isContentEditable ? 'contenteditable' : (el.type || null),
        role: el.getAttribute('role') || null,
        selector: buildSelector(el),
        label: accessibleName(el),
        value: el.value !== undefined ? String(el.value).slice(0, 200) : null,
        checked: el.checked !== undefined ? el.checked : null,
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || null,
        placeholder: el.placeholder || el.getAttribute('data-placeholder') || null,
        href: el.href || null,
        position: rect(el)
      }))
      .filter(e => e.selector);

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
    const INTERACTIVE = 'button, input:not([type=hidden]), select, textarea, [contenteditable]:not([contenteditable="false"]), a[href], [role="button"], [role="tab"], [role="menuitem"], [role="textbox"], [role="combobox"], [role="switch"], [onclick]';

    const elements = querySelectorAllDeep(INTERACTIVE, root || document)
      .filter(isVisible)
      .slice(0, maxElements)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.isContentEditable ? 'contenteditable' : (el.type || el.getAttribute('role') || null),
        selector: buildSelector(el),
        label: accessibleName(el).slice(0, 60),
        value: el.isContentEditable
          ? (el.innerText?.trim().slice(0, 80) || null)
          : (el.value !== undefined && el.value ? String(el.value).slice(0, 80) : null)
      }))
      .filter(e => e.selector);

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
    const el = querySelectorDeep(selector);
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
    const target = selector ? querySelectorDeep(selector) : document.activeElement;
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

  GET_ELEMENT_RECT({ selector, scrollIntoView = true } = {}) {
    const el = querySelectorDeep(selector);
    if (!el) return { success: false, error: `Element not found: ${selector}` };

    // Scroll element into view so captureVisibleTab captures it correctly
    if (scrollIntoView) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }

    const r = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Clamp to viewport bounds — the element may still be partially off-screen
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = Math.max(0, r.x);
    const cy = Math.max(0, r.y);
    const cw = Math.min(r.right, vw) - cx;
    const ch = Math.min(r.bottom, vh) - cy;

    if (cw <= 0 || ch <= 0) return { success: false, error: `Element "${selector}" is not visible in the viewport` };

    return {
      success: true,
      selector,
      scrolled: scrollIntoView,
      rect: {
        x: Math.round(cx),
        y: Math.round(cy),
        width: Math.round(cw),
        height: Math.round(ch),
        devicePixelRatio: dpr,
        px: Math.round(cx * dpr),
        py: Math.round(cy * dpr),
        pw: Math.round(cw * dpr),
        ph: Math.round(ch * dpr)
      }
    };
  },

  async WRITE_TO_REGION({ rootSelector, text } = {}) {
    const root = rootSelector ? document.querySelector(rootSelector) : document.body;
    if (!root) return { success: false, error: `Region not found: ${rootSelector}` };

    // Find the best editable target inside the region
    const editable =
      root.matches('[contenteditable]') ? root :
      root.querySelector('[contenteditable="true"], [contenteditable=""]') ||
      root.querySelector('textarea, input:not([type=hidden]):not([type=submit]):not([type=button])');

    if (!editable) return { success: false, error: 'No editable element found in region' };

    // Step 1 — click to activate the editor (required for Lexical/ProseMirror)
    editable.scrollIntoView({ block: 'center' });
    const r = editable.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const ptrOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
    editable.dispatchEvent(new PointerEvent('pointerdown', { ...ptrOpts, button: 0, buttons: 1 }));
    editable.dispatchEvent(new MouseEvent('mousedown', { ...ptrOpts, button: 0, buttons: 1 }));
    editable.dispatchEvent(new PointerEvent('pointerup', { ...ptrOpts, button: 0 }));
    editable.dispatchEvent(new MouseEvent('mouseup', { ...ptrOpts, button: 0 }));
    editable.click();
    editable.focus();
    await new Promise(r => setTimeout(r, 300));

    // Step 2 — clear existing content
    if (editable.isContentEditable) {
      editable.innerHTML = '';
    } else {
      const proto = editable.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(editable, '');
      else editable.value = '';
    }
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));

    // Step 3 — paste via clipboard (most reliable for Lexical/ProseMirror/rich editors)
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      editable.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));
      // Verify paste worked
      const pasted = editable.isContentEditable ? editable.innerText : editable.value;
      if (pasted.trim().length > 0) {
        return { success: true, method: 'paste', selector: editable.id ? `#${editable.id}` : editable.tagName.toLowerCase(), preview: pasted.slice(0, 120) };
      }
    } catch (_) { /* fall through */ }

    // Step 4 — fallback: execCommand insertText
    const inserted = document.execCommand('insertText', false, text);
    if (inserted) {
      const val = editable.isContentEditable ? editable.innerText : editable.value;
      return { success: true, method: 'execCommand', preview: val.slice(0, 120) };
    }

    // Step 5 — last resort: set innerText / value directly
    if (editable.isContentEditable) {
      editable.innerText = text;
      editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    } else {
      const proto = editable.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(editable, text);
      else editable.value = text;
      editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
    editable.dispatchEvent(new Event('change', { bubbles: true }));
    const final = editable.isContentEditable ? editable.innerText : editable.value;
    return { success: true, method: 'direct', preview: final.slice(0, 120) };
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
  },

  CLASSIFY_PAGE() {
    const url = location.href;
    const title = document.title;
    const bodyText = document.body?.innerText?.slice(0, 3000) || '';

    // Detect page type from URL patterns and DOM landmarks
    const hasForms = document.querySelectorAll('form').length > 0;
    const hasComments = !!document.querySelector(
      '[class*="comment"], [id*="comment"], [class*="discussion"], [id*="discussion"], ' +
      '[class*="reply"], [id*="reply"], [class*="responses"], [data-testid*="reply"]'
    );
    const hasArticle = !!document.querySelector('article, [role="article"], [class*="article"], [class*="post-content"], [class*="entry-content"]');
    const hasProductPrice = !!document.querySelector('[class*="price"], [itemprop="price"], [class*="product"]');
    const hasInfiniteScroll = !!document.querySelector('[class*="feed"], [class*="timeline"], [class*="stream"]');
    const hasLoginForm = !!document.querySelector('input[type="password"]');
    const hasSearchBox = !!document.querySelector('input[type="search"], [role="searchbox"], input[name*="search"], input[placeholder*="search" i], input[placeholder*="recherche" i]');
    const hasVideoPlayer = !!document.querySelector('video, [class*="player"], [id*="player"]');
    const hasPagination = !!document.querySelector('[class*="pagination"], [aria-label*="pagination"], a[href*="page="]');

    const urlLower = url.toLowerCase();
    const isSocialMedia = /twitter\.com|x\.com|linkedin\.com|facebook\.com|instagram\.com|reddit\.com|tiktok\.com/.test(urlLower);
    const isEcommerce = /amazon\.|ebay\.|shopify|etsy\.com|\.shop\/|\/product\/|\/products\//.test(urlLower) || hasProductPrice;
    const isNews = /news\.|article|\/post\/|\/blog\/|medium\.com/.test(urlLower) || hasArticle;
    const isSearch = /\/search[?\/]|google\.com\/search|bing\.com\/search/.test(urlLower);
    const isVideo = /youtube\.com|vimeo\.com|dailymotion|twitch\.tv/.test(urlLower) || hasVideoPlayer;
    const isForm = hasForms && !isSocialMedia && !isEcommerce;
    const isDocs = /docs\.|\/docs\/|\/documentation\/|readthedocs|gitbook/.test(urlLower);

    let type = 'generic';
    if (hasLoginForm) type = 'login';
    else if (isSearch) type = 'search_results';
    else if (isVideo) type = 'video';
    else if (isSocialMedia && hasInfiniteScroll) type = 'social_feed';
    else if (isSocialMedia && hasComments) type = 'social_post';
    else if (isSocialMedia) type = 'social';
    else if (isEcommerce) type = 'product';
    else if (isNews || hasArticle) type = 'article';
    else if (isDocs) type = 'documentation';
    else if (isForm) type = 'form';

    const features = [];
    if (hasComments) features.push('comments');
    if (hasPagination) features.push('pagination');
    if (hasInfiniteScroll) features.push('infinite_scroll');
    if (hasSearchBox) features.push('search_box');
    if (hasForms) features.push('forms');
    if (hasVideoPlayer) features.push('video_player');

    return { type, title, url, features };
  },

  DISMISS_OVERLAY() {
    const dismissed = [];

    // Common dismiss selectors: cookie banners, GDPR, modals, popups
    const dismissSelectors = [
      // Accept/close buttons by text
      ...querySelectorAllDeep('button, a[role="button"], [role="button"]').filter(el => {
        const text = el.innerText?.trim().toLowerCase();
        return text && (
          text === 'accept' || text === 'accept all' || text === 'accept cookies' ||
          text === 'tout accepter' || text === 'accepter' || text === "j'accepte" ||
          text === 'agree' || text === 'i agree' || text === 'ok' || text === 'got it' ||
          text === 'close' || text === 'dismiss' || text === 'fermer' || text === 'continuer' ||
          text === 'continue' || text === 'i understand' || text === "d'accord"
        );
      }),
      // Selector-based close buttons
      ...querySelectorAllDeep(
        '[class*="cookie"] button, [id*="cookie"] button, [class*="consent"] button, ' +
        '[class*="gdpr"] button, [class*="banner"] button[class*="close"], ' +
        '[class*="modal"] button[aria-label*="close" i], [class*="popup"] button[class*="close"], ' +
        '[class*="overlay"] button[class*="close"], button[aria-label="Close"], ' +
        'button[aria-label="Fermer"], button[aria-label="close dialog"]'
      )
    ];

    // Deduplicate by reference
    const seen = new Set();
    const targets = dismissSelectors.filter(el => {
      if (seen.has(el)) return false;
      seen.add(el);
      // Only dismiss if the element is visible
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    for (const el of targets.slice(0, 3)) {
      try {
        el.click();
        dismissed.push(el.innerText?.trim().slice(0, 40) || el.getAttribute('aria-label') || el.tagName);
      } catch { /* skip */ }
    }

    return { dismissed, count: dismissed.length };
  },

  FIND_COMMENT_BOX() {
    // Ordered from most specific to most generic
    const candidates = querySelectorAllDeep(
      'textarea[placeholder*="comment" i], textarea[placeholder*="reply" i], ' +
      'textarea[placeholder*="Write" i], textarea[placeholder*="Add" i], ' +
      'textarea[placeholder*="commentaire" i], textarea[placeholder*="réponse" i], ' +
      '[contenteditable="true"][placeholder*="comment" i], ' +
      '[contenteditable="true"][placeholder*="reply" i], ' +
      '[contenteditable="true"][data-placeholder*="comment" i], ' +
      '[contenteditable="true"][aria-label*="comment" i], ' +
      '[contenteditable="true"][aria-label*="reply" i], ' +
      '[contenteditable="true"][aria-label*="Add a comment" i], ' +
      '[role="textbox"][aria-label*="comment" i], ' +
      '[role="textbox"][aria-label*="reply" i]'
    );

    // Also check for comment form containers
    const formContainers = querySelectorAllDeep(
      'form[id*="comment"], form[class*="comment"], ' +
      '[id*="comment-form"], [class*="comment-form"], ' +
      '[id*="reply-form"], [class*="reply-form"]'
    );

    const formInputs = formContainers.flatMap(form =>
      Array.from(form.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'))
    );

    const all = [...candidates, ...formInputs];
    const seen = new Set();
    const unique = all.filter(el => {
      if (seen.has(el)) return false;
      seen.add(el);
      const rect = el.getBoundingClientRect();
      return rect.width > 0;
    });

    if (unique.length === 0) return { found: false, selector: null, count: 0 };

    const el = unique[0];

    // Build a best-effort unique selector
    let selector = null;
    if (el.id) selector = `#${CSS.escape(el.id)}`;
    else if (el.getAttribute('data-testid')) selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
    else if (el.getAttribute('aria-label')) selector = `[aria-label="${el.getAttribute('aria-label')}"]`;
    else {
      const tag = el.tagName.toLowerCase();
      const cls = Array.from(el.classList).slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
      selector = `${tag}${cls}`;
    }

    const rect = el.getBoundingClientRect();
    return {
      found: true,
      selector,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || (el.isContentEditable ? 'contenteditable' : el.tagName.toLowerCase()),
      placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-label') || '',
      count: unique.length,
      rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) }
    };
  },

  // Find a clickable control (button, link, role=button, menu item) by its visible
  // text or accessible name. Built for SPAs like LinkedIn/Facebook where the
  // "Start a post", "Write a comment", "Like", "Send" controls are <div role=button>
  // with hashed classes and no stable id. Returns ranked candidates with stable
  // selectors so the agent can click without guessing.
  FIND_ACTION_BUTTON({ query, limit = 5 } = {}) {
    if (!query) return { found: false, matches: [], error: 'No query provided' };
    const q = query.toLowerCase().trim();
    const words = q.split(/\s+/).filter(Boolean);

    const CLICKABLE = 'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="tab"], input[type="submit"], input[type="button"], [onclick], [tabindex]:not([tabindex="-1"])';
    const seen = new Set();
    const candidates = querySelectorAllDeep(CLICKABLE).filter(el => {
      if (seen.has(el)) return false;
      seen.add(el);
      return isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    });

    const scoreFor = (name) => {
      const n = name.toLowerCase().trim();
      if (!n) return 0;
      if (n === q) return 100;                          // exact
      if (n.startsWith(q)) return 85;                   // prefix
      if (n.includes(q)) return 70;                     // substring
      const hits = words.filter(w => n.includes(w)).length; // all/some words present
      if (hits === words.length) return 55;
      if (hits > 0) return 30 + hits * 5;
      return 0;
    };

    const ranked = candidates.map(el => {
      const name = accessibleName(el);
      // Also consider title/value attributes that aren't the accessible name
      const altNames = [name, el.getAttribute('title') || '', el.value || ''];
      const score = Math.max(...altNames.map(scoreFor));
      const r = el.getBoundingClientRect();
      // Mild preference for larger, on-screen, top-of-page controls
      const onScreen = r.top >= 0 && r.top < window.innerHeight;
      return { el, name, score: score + (onScreen ? 3 : 0), rect: r };
    })
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (ranked.length === 0) return { found: false, matches: [], query };

    const matches = ranked.map(({ el, name, score, rect }) => ({
      selector: buildSelector(el),
      label: name,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || null,
      score,
      rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) }
    })).filter(m => m.selector);

    return { found: matches.length > 0, query, count: matches.length, matches, best: matches[0] || null };
  },

  SEARCH_ON_PAGE({ query, limit = 10 } = {}) {
    if (!query) return { matches: [], count: 0, error: 'No query provided' };
    const q = query.toLowerCase();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const tag = node.parentElement?.tagName;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(tag)) return NodeFilter.FILTER_REJECT;
        return node.textContent.toLowerCase().includes(q) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });

    const matches = [];
    while (walker.nextNode() && matches.length < limit) {
      const node = walker.currentNode;
      const text = node.textContent;
      const idx = text.toLowerCase().indexOf(q);
      const start = Math.max(0, idx - 60);
      const end = Math.min(text.length, idx + query.length + 60);
      const el = node.parentElement;
      let sel = null;
      if (el.id) sel = `#${CSS.escape(el.id)}`;
      else { const tag = el.tagName.toLowerCase(); const cls = Array.from(el.classList).slice(0,1).map(c => `.${CSS.escape(c)}`).join(''); sel = `${tag}${cls}`; }
      matches.push({ excerpt: text.slice(start, end).trim(), selector: sel });
    }

    return { query, matches, count: matches.length };
  },

  async READ_THREAD({ selector, maxComments = 30, loadMoreSelector, waitMs = 1000 } = {}) {
    const root = selector ? document.querySelector(selector) : document.body;
    if (selector && !root) return { error: `Selector not found: ${selector}`, comments: [] };

    // Try to click "load more" / "show more comments" buttons
    if (loadMoreSelector) {
      const btn = document.querySelector(loadMoreSelector);
      if (btn) {
        btn.click();
        await new Promise(r => setTimeout(r, waitMs));
      }
    } else {
      // Auto-detect load more buttons
      const loadMoreCandidates = Array.from(document.querySelectorAll('button, a[role="button"]')).filter(el => {
        const t = el.innerText?.trim().toLowerCase();
        return t && (t.includes('load more') || t.includes('show more') || t.includes('voir plus') ||
          t.includes('more comment') || t.includes('more replies') || t.includes('plus de commentaires'));
      });
      for (const btn of loadMoreCandidates.slice(0, 2)) {
        btn.click();
        await new Promise(r => setTimeout(r, waitMs));
      }
    }

    // Extract comment-like elements
    const commentSelectors = [
      '[class*="comment"]', '[class*="reply"]', '[class*="response"]',
      '[data-testid*="reply"]', '[data-testid*="comment"]',
      'article', '[role="article"]'
    ];

    let items = [];
    for (const sel of commentSelectors) {
      const found = Array.from((root || document.body).querySelectorAll(sel));
      if (found.length >= 2) { items = found; break; }
    }

    const comments = items.slice(0, maxComments).map(el => {
      const author = el.querySelector('[class*="author"], [class*="name"], [class*="user"], [rel="author"]')?.innerText?.trim() || '';
      const time = el.querySelector('time, [class*="time"], [class*="date"]')?.innerText?.trim() || '';
      const text = el.innerText?.trim().slice(0, 500) || '';
      return { author, time, text };
    }).filter(c => c.text.length > 5);

    return {
      count: comments.length,
      comments,
      rootSelector: selector || null
    };
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
    background: '#10b981', color: '#fff', fontSize: '10px', fontFamily: 'monospace',
    padding: '1px 5px', borderRadius: '0 0 4px 0', pointerEvents: 'none',
    whiteSpace: 'nowrap', maxWidth: '240px',
    overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '16px'
  });
  badge.textContent = selector;

  // Use fixed positioning — matches the picker overlay and requires no scroll math
  _regionHighlight = document.createElement('div');
  Object.assign(_regionHighlight.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
    border: '2px solid #10b981', borderRadius: '3px',
    background: 'rgba(16,185,129,0.08)',
    boxShadow: '0 0 0 1px rgba(16,185,129,0.4)',
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

  // Collect all scrollable ancestors (SPAs like LinkedIn scroll inner containers, not window)
  const scrollParents = [];
  let ancestor = el.parentElement;
  while (ancestor && ancestor !== document.documentElement) {
    const { overflow, overflowY, overflowX } = getComputedStyle(ancestor);
    if (/auto|scroll/.test(overflow + overflowY + overflowX)) {
      scrollParents.push(ancestor);
      ancestor.addEventListener('scroll', reposition, { passive: true });
    }
    ancestor = ancestor.parentElement;
  }
  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition, { passive: true });

  _regionHighlightObs = new ResizeObserver(reposition);
  _regionHighlightObs.observe(el);

  _regionHighlight._teardown = () => {
    _regionHighlightObs?.disconnect();
    window.removeEventListener('scroll', reposition);
    window.removeEventListener('resize', reposition);
    scrollParents.forEach(p => p.removeEventListener('scroll', reposition));
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
