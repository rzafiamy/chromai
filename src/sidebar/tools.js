// Browser tool definitions for the lemura agent.
// Each tool sends a message to the content script running in the active tab.

async function sendToContentScript(action, params = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found');

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { action, ...params }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.success === false) {
        reject(new Error(response.error || 'Tool execution failed'));
        return;
      }
      resolve(response?.data ?? response);
    });
  });
}

export const browserTools = [
  {
    name: 'getPageContent',
    description: 'Get the visible text content of the current web page, including its title and URL. Use this first to understand the page before taking actions.',
    parameters: {
      type: 'object',
      properties: {
        maxLength: {
          type: 'number',
          description: 'Maximum characters to return (default 12000)'
        }
      }
    },
    async execute(p) {
      return sendToContentScript('GET_PAGE_CONTENT', { maxLength: p?.maxLength || 12000 });
    }
  },

  {
    name: 'getPageMeta',
    description: 'Get page metadata: title, description, og:title, og:image, canonical URL, language.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return sendToContentScript('GET_META');
    }
  },

  {
    name: 'getSelectedText',
    description: 'Get any text the user has currently selected/highlighted on the page.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return sendToContentScript('GET_SELECTED_TEXT');
    }
  },

  {
    name: 'extractLinks',
    description: 'Extract hyperlinks from the page or a specific section. Returns text, href, and title for each link.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to scope extraction (e.g. "nav", "main", "#sidebar"). Defaults to full page.'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of links to return (default 50)'
        }
      }
    },
    async execute(p) {
      return sendToContentScript('EXTRACT_LINKS', { selector: p?.selector, limit: p?.limit || 50 });
    }
  },

  {
    name: 'extractTable',
    description: 'Extract data from an HTML table on the page. Returns rows as arrays of cell text.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the table element (e.g. "table", "#results-table", ".data-grid")'
        }
      },
      required: ['selector']
    },
    async execute(p) {
      return sendToContentScript('EXTRACT_TABLE', { selector: p.selector });
    }
  },

  {
    name: 'clickElement',
    description: 'Click an element on the page. Use for buttons, links, tabs, dropdowns. Identify the element by CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of the element to click (e.g. "#submit-btn", "button.primary", "a[href*=login]")'
        },
        waitAfterMs: {
          type: 'number',
          description: 'Milliseconds to wait after clicking for page to update (default 500)'
        }
      },
      required: ['selector']
    },
    async execute(p) {
      return sendToContentScript('CLICK_ELEMENT', {
        selector: p.selector,
        waitAfterMs: p?.waitAfterMs || 500
      });
    }
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
    async execute(p) {
      return sendToContentScript('FILL_FORM', { fields: p.fields });
    }
  },

  {
    name: 'submitForm',
    description: 'Submit a form on the page by clicking its submit button or calling form.submit().',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of the form element or a submit button inside it'
        }
      },
      required: ['selector']
    },
    async execute(p) {
      return sendToContentScript('SUBMIT_FORM', { selector: p.selector });
    }
  },

  {
    name: 'scrollPage',
    description: 'Scroll the page in a direction, or scroll a specific element into view.',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'top', 'bottom'],
          description: 'Scroll direction (default: down)'
        },
        amount: {
          type: 'number',
          description: 'Pixels to scroll for up/down (default: 500)'
        },
        selector: {
          type: 'string',
          description: 'CSS selector of element to scroll into view. Overrides direction/amount.'
        }
      }
    },
    async execute(p) {
      return sendToContentScript('SCROLL_PAGE', {
        direction: p?.direction || 'down',
        amount: p?.amount || 500,
        selector: p?.selector
      });
    }
  },

  {
    name: 'highlightElement',
    description: 'Visually highlight an element on the page with an orange outline for 2.5 seconds. Useful to show the user what you found.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of the element to highlight'
        }
      },
      required: ['selector']
    },
    async execute(p) {
      return sendToContentScript('HIGHLIGHT_ELEMENT', { selector: p.selector });
    }
  },

  {
    name: 'waitForElement',
    description: 'Wait for an element to appear in the DOM. Useful after clicks that trigger async content loads.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to wait for'
        },
        timeoutMs: {
          type: 'number',
          description: 'Maximum wait time in milliseconds (default 5000)'
        }
      },
      required: ['selector']
    },
    async execute(p) {
      return sendToContentScript('WAIT_FOR_ELEMENT', {
        selector: p.selector,
        timeoutMs: p?.timeoutMs || 5000
      });
    }
  }
];
