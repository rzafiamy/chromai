// Browser tool definitions for the lemura agent.
// Each tool sends a message to the content script running in the active tab.

// Global focus region — set by the element picker in the sidebar.
// When non-null, content-reading tools scope their results to this CSS selector.
let _focusRegion = null;
export const setFocusRegion = (selector) => { _focusRegion = selector; };
export const getFocusRegion = () => _focusRegion;

const getActiveTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found');
  return tab;
};

const isNoReceiverError = (msg) => msg?.includes('Receiving end does not exist') || msg?.includes('Could not establish connection');

const injectContentScript = (tabId) =>
  chrome.scripting.executeScript({ target: { tabId }, files: ['content/content-script.js'] });

const sendMessage = (tabId, payload) =>
  new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (response?.success === false) { reject(new Error(response.error || 'Tool execution failed')); return; }
      resolve(response?.data ?? response);
    });
  });

const sendToContentScript = async (action, params = {}) => {
  const tab = await getActiveTab();
  const payload = { action, ...params };
  try {
    return await sendMessage(tab.id, payload);
  } catch (err) {
    if (!isNoReceiverError(err.message)) throw err;
    // Content script not yet injected in this tab (stale tab or restricted page).
    // Inject on demand and retry once.
    await injectContentScript(tab.id);
    await new Promise((r) => setTimeout(r, 200));
    return sendMessage(tab.id, payload);
  }
};

const captureTabScreenshot = async () => {
  // captureVisibleTab must be called from the sidebar (extension page), not content script
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 85 });
  return dataUrl.replace(/^data:image\/\w+;base64,/, '');
};

// Crop a base64 JPEG/PNG to the given rect using an OffscreenCanvas
const cropScreenshot = async (dataUrl, rect) => {
  const blob = await fetch(dataUrl).then(r => r.blob());
  const bitmap = await createImageBitmap(blob);
  const { px, py, pw, ph } = rect;
  const canvas = new OffscreenCanvas(pw, ph);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, px, py, pw, ph, 0, 0, pw, ph);
  const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  const buf = await outBlob.arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
};

const navigateTab = async (url) => {
  const tab = await getActiveTab();

  // Block navigation to a different origin than the current tab.
  const currentOrigin = new URL(tab.url).origin;
  const targetOrigin = new URL(url).origin;
  if (currentOrigin !== targetOrigin) {
    throw new Error(
      `Navigation blocked: cannot leave the current site (${currentOrigin}). ` +
      `Requested URL is on a different origin (${targetOrigin}).`
    );
  }

  await chrome.tabs.update(tab.id, { url });
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10000);
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  await new Promise((r) => setTimeout(r, 800));
};

export const capturePageContext = async () => {
  try {
    const tab = await getActiveTab();
    const payload = { action: 'GET_PAGE_CONTEXT', rootSelector: _focusRegion || undefined };
    const ask = () => new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, payload, (response) => {
        const errMsg = chrome.runtime.lastError?.message;
        if (errMsg || !response?.success) { resolve({ error: errMsg }); return; }
        resolve({ data: response.data });
      });
    });
    const first = await ask();
    if (first.data !== undefined) return { ...first.data, focusRegion: _focusRegion };
    if (!isNoReceiverError(first.error)) return null;
    // Content script missing — inject and retry once.
    await injectContentScript(tab.id);
    await new Promise((r) => setTimeout(r, 200));
    const retry = await ask();
    return retry.data ? { ...retry.data, focusRegion: _focusRegion } : null;
  } catch {
    return null;
  }
};

export const browserTools = [
  {
    name: 'getPageContent',
    description: 'Get the visible text content of the current web page, including its title and URL. Use this first to understand the page before taking actions. Optionally scope to a DOM subtree with rootSelector.',
    parameters: {
      type: 'object',
      properties: {
        maxLength: { type: 'number', description: 'Maximum characters to return (default 12000)' },
        rootSelector: { type: 'string', description: 'CSS selector of the root element to read from (e.g. "main", "#content", ".article-body"). Omit to read the whole page.' }
      }
    },
    execute: (p) => sendToContentScript('GET_PAGE_CONTENT', { maxLength: p?.maxLength || 12000, rootSelector: p?.rootSelector ?? _focusRegion })
  },

  {
    name: 'getPageMeta',
    description: 'Get page metadata: title, description, og:title, og:image, canonical URL, language.',
    parameters: { type: 'object', properties: {} },
    execute: () => sendToContentScript('GET_META')
  },

  {
    name: 'getSelectedText',
    description: 'Get any text the user has currently selected/highlighted on the page.',
    parameters: { type: 'object', properties: {} },
    execute: () => sendToContentScript('GET_SELECTED_TEXT')
  },

  {
    name: 'extractLinks',
    description: 'Extract hyperlinks from the page or a specific section. Returns text, href, and title for each link.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to scope extraction (e.g. "nav", "main", "#sidebar"). Defaults to full page.' },
        limit: { type: 'number', description: 'Maximum number of links to return (default 50)' }
      }
    },
    execute: (p) => sendToContentScript('EXTRACT_LINKS', { selector: p?.selector ?? _focusRegion, limit: p?.limit || 50 })
  },

  {
    name: 'extractTable',
    description: 'Extract data from an HTML table on the page. Returns rows as arrays of cell text.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the table element (e.g. "table", "#results-table", ".data-grid")' }
      },
      required: ['selector']
    },
    execute: ({ selector }) => sendToContentScript('EXTRACT_TABLE', { selector })
  },

  {
    name: 'clickElement',
    description: 'Click an element on the page. Use for buttons, links, tabs, dropdowns. Identify the element by CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to click (e.g. "#submit-btn", "button.primary", "a[href*=login]")' },
        waitAfterMs: { type: 'number', description: 'Milliseconds to wait after clicking for page to update (default 500)' }
      },
      required: ['selector']
    },
    execute: ({ selector, waitAfterMs = 500 }) => sendToContentScript('CLICK_ELEMENT', { selector, waitAfterMs })
  },

  {
    name: 'fillForm',
    description: 'Fill one or more form input fields. Dispatches native input events so React/Vue forms update correctly.',
    parameters: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          description: 'Array of field/value pairs to fill',
          items: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector for the input field' },
              value: { type: 'string', description: 'Value to set' }
            },
            required: ['selector', 'value']
          }
        }
      },
      required: ['fields']
    },
    execute: ({ fields }) => sendToContentScript('FILL_FORM', { fields })
  },

  {
    name: 'submitForm',
    description: 'Submit a form on the page by clicking its submit button or calling form.submit().',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the form element or a submit button inside it' }
      },
      required: ['selector']
    },
    execute: ({ selector }) => sendToContentScript('SUBMIT_FORM', { selector })
  },

  {
    name: 'scrollPage',
    description: 'Scroll the page in a direction, or scroll a specific element into view.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'Scroll direction (default: down)' },
        amount: { type: 'number', description: 'Pixels to scroll for up/down (default: 500)' },
        selector: { type: 'string', description: 'CSS selector of element to scroll into view. Overrides direction/amount.' }
      }
    },
    execute: (p) => sendToContentScript('SCROLL_PAGE', {
      direction: p?.direction || 'down',
      amount: p?.amount || 500,
      selector: p?.selector
    })
  },

  {
    name: 'highlightElement',
    description: 'Visually highlight an element on the page with an orange outline for 2.5 seconds. Useful to show the user what you found.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to highlight' }
      },
      required: ['selector']
    },
    execute: ({ selector }) => sendToContentScript('HIGHLIGHT_ELEMENT', { selector })
  },

  {
    name: 'waitForElement',
    description: 'Wait for an element to appear in the DOM. Useful after clicks that trigger async content loads.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeoutMs: { type: 'number', description: 'Maximum wait time in milliseconds (default 5000)' }
      },
      required: ['selector']
    },
    execute: ({ selector, timeoutMs = 5000 }) => sendToContentScript('WAIT_FOR_ELEMENT', { selector, timeoutMs })
  },

  {
    name: 'getInteractiveElements',
    description: 'Return every visible interactive element on the page (inputs, buttons, links, dropdowns, checkboxes) with its resolved label, CSS selector, current value, and screen position. Use this before fillForm or clickElement to discover what is on the page and which selector to use.',
    parameters: {
      type: 'object',
      properties: {
        includeHidden: { type: 'boolean', description: 'Include elements that are not currently visible (default false)' }
      }
    },
    execute: (p) => sendToContentScript('GET_INTERACTIVE_ELEMENTS', { includeHidden: p?.includeHidden || false })
  },

  {
    name: 'getForms',
    description: "Return all forms on the page grouped by their <form> element, with every field's label, selector, type, current value, and required status. Also returns inputs that exist outside a <form> tag (common in React/Vue SPAs). Use this to understand form structure before filling fields.",
    parameters: { type: 'object', properties: {} },
    execute: () => sendToContentScript('GET_FORMS')
  },

  {
    name: 'navigateTo',
    description: 'Navigate the current browser tab to a URL and wait for the page to load. Use this to open a website, social media profile page, or search results URL.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to navigate to (e.g. "https://twitter.com/search?q=Nicolas+Dupont")' }
      },
      required: ['url']
    },
    execute: async ({ url }) => {
      await navigateTab(url);
      return sendToContentScript('GET_PAGE_CONTENT', { maxLength: 8000 });
    }
  },

  {
    name: 'analyzePageVisually',
    description: 'Take a screenshot of the visible page and analyze it using vision/OCR. Use this when: the page content cannot be extracted as text (canvas, image-based UI, PDF viewer, charts), you need to understand visual layout for form filling, or the user asks what they see on screen.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to focus on in the analysis, e.g. "find all form fields and their labels", "extract all text visible on screen", "describe the page layout". Defaults to a general OCR + layout description.' }
      }
    },
    // _adapter is injected by lemura's ToolContext when tools are executed
    execute: async (p, context) => {
      const { adapter } = context ?? {};
      if (!adapter) throw new Error('Vision requires a provider adapter in tool context');

      const imageBase64 = await captureTabScreenshot();
      const prompt = p?.prompt ||
        'Describe this web page screenshot in detail. Extract all visible text (OCR), identify form fields with their labels, buttons, and the overall layout structure. Be precise about element positions relative to each other.';

      const result = await adapter.describeImage({ imageBase64, prompt });
      return { analysis: result.description, objects: result.objects };
    }
  },

  {
    name: 'scrollAndRead',
    description: 'Scroll the page down and return the newly visible text. Use this to load and read more posts on infinite-scroll feeds (Twitter, LinkedIn, Facebook, etc.).',
    parameters: {
      type: 'object',
      properties: {
        scrolls: { type: 'number', description: 'Number of scroll steps to perform before reading (default 3, max 10)' },
        waitMs: { type: 'number', description: 'Milliseconds to wait between each scroll for content to load (default 1200)' },
        maxLength: { type: 'number', description: 'Maximum characters of page text to return (default 12000)' }
      }
    },
    execute: (p) => sendToContentScript('SCROLL_AND_READ', {
      scrolls: Math.min(p?.scrolls || 3, 10),
      waitMs: p?.waitMs || 1200,
      maxLength: p?.maxLength || 12000
    })
  },

  {
    name: 'typeText',
    description: 'Type text into a focused input, textarea, or contenteditable element character-by-character, firing real keyboard and input events. Use this when fillForm fails on complex editors (CodeMirror, ProseMirror, rich-text fields). Can optionally clear the field first and press Enter at the end.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to type into' },
        text: { type: 'string', description: 'Text to type' },
        clearFirst: { type: 'boolean', description: 'Clear the current value before typing (default false)' },
        pressEnter: { type: 'boolean', description: 'Press Enter key after typing (default false)' }
      },
      required: ['selector', 'text']
    },
    execute: ({ selector, text, clearFirst = false, pressEnter = false }) =>
      sendToContentScript('TYPE_TEXT', { selector, text, clearFirst, pressEnter })
  },

  {
    name: 'pressKey',
    description: 'Dispatch a keyboard event on an element or the currently focused element. Use for hotkeys, Escape, Tab, arrow keys, or any key combination.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of target element. Omit to fire on the currently active element.' },
        key: { type: 'string', description: 'Key value (e.g. "Enter", "Escape", "Tab", "ArrowDown", "a")' },
        modifiers: {
          type: 'array',
          description: 'Modifier keys to hold (e.g. ["ctrl"], ["shift", "alt"])',
          items: { type: 'string', enum: ['ctrl', 'shift', 'alt', 'meta'] }
        }
      },
      required: ['key']
    },
    execute: ({ selector, key, modifiers = [] }) =>
      sendToContentScript('PRESS_KEY', { selector, key, modifiers })
  },

  {
    name: 'captureRegion',
    description: 'Take a screenshot of a specific element or region on the page and analyze it with vision. Useful for charts, image-based UI sections, or any area the user wants to examine visually without processing the whole page.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to capture (e.g. "#chart", ".hero-image", "table.results")' },
        prompt: { type: 'string', description: 'What to look for or extract from the captured region.' }
      },
      required: ['selector']
    },
    execute: async (p, context) => {
      const { adapter } = context ?? {};
      if (!adapter) throw new Error('Vision requires a provider adapter in tool context');

      const rectResult = await sendToContentScript('GET_ELEMENT_RECT', { selector: p.selector });
      if (!rectResult.success) throw new Error(rectResult.error);

      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 90 });
      const imageBase64 = await cropScreenshot(dataUrl, rectResult.rect);

      const prompt = p.prompt ||
        'Describe what you see in this element: extract all visible text, identify any charts or data, and describe the visual structure.';

      const result = await adapter.describeImage({ imageBase64, prompt });
      return { selector: p.selector, rect: rectResult.rect, analysis: result.description, objects: result.objects };
    }
  }
];
