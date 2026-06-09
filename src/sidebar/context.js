// Context preparation layer.
//
// Before each user message is sent to the agent, we enrich the raw page context
// captured from the content script with two things a human user grasps instantly
// but the agent otherwise has to spend tool calls to discover:
//
//   1. A decomposed URL — registrable domain, subdomain, path segments, query
//      params — so the agent reasons about WHERE it is structurally, not just a
//      raw href string.
//   2. An AI-derived page profile — what KIND of page this is (blog article,
//      social feed, video list, search results, web app, form, …) and what the
//      interface affords. This is computed once per session and reused, because
//      the page type does not change while the user chats about the same page.
//
// The profile is intentionally cached for the lifetime of the session. The
// session itself is reset on tab change / clear chat (see sidebar.js), at which
// point resetSessionContext() must be called to drop the stale profile.

// Cached page profile for the current session. Null until the first turn
// classifies the page; reused verbatim for every subsequent turn.
let _sessionProfile = null;

// Drop the cached profile. Call this whenever the agent session is reset
// (tab change, clear chat) so the next turn re-classifies the new page.
export const resetSessionContext = () => { _sessionProfile = null; };

// Break a URL into the parts the agent actually reasons about. Pure string work,
// no network — so this runs every turn (it's free) even though classification is
// cached. Registrable-domain extraction is a pragmatic heuristic: it strips a
// known set of multi-part public suffixes (co.uk, com.au, …) then takes the last
// two labels. Good enough for orientation; we are not doing PSL-grade parsing.
const MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za',
  'com.au', 'com.br', 'com.cn', 'com.mx', 'com.tr', 'net.au', 'org.au'
]);

export const decomposeUrl = (rawUrl) => {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname;
    const labels = host.split('.').filter(Boolean);

    // Determine registrable domain (eTLD+1) and subdomain.
    let domain = host;
    let subdomain = '';
    if (labels.length >= 2) {
      const lastTwo = labels.slice(-2).join('.');
      const takeN = MULTI_PART_TLDS.has(lastTwo) ? 3 : 2;
      domain = labels.slice(-takeN).join('.');
      subdomain = labels.slice(0, labels.length - takeN).join('.');
    }

    const pathSegments = u.pathname.split('/').filter(Boolean);
    const query = {};
    for (const [k, v] of u.searchParams.entries()) query[k] = v;

    return {
      href: u.href,
      protocol: u.protocol.replace(':', ''),
      host,
      domain,
      subdomain: subdomain || null,
      path: u.pathname,
      pathSegments,
      query,
      hash: u.hash ? u.hash.slice(1) : null
    };
  } catch {
    return { href: rawUrl, host: null, domain: null, subdomain: null, path: null, pathSegments: [], query: {}, hash: null };
  }
};

// Ask the main model to classify the page. We feed it the cheap deterministic
// signals already gathered (URL parts, title, DOM landmark summary, heuristic
// page type) and ask for a compact JSON verdict. Kept to a tiny token budget and
// a single call — this happens once per session.
const classifyPageWithAI = async (adapter, { settings, urlParts, ctx, heuristic }) => {
  const signals = [
    `URL: ${urlParts.href}`,
    `Domain: ${urlParts.domain}${urlParts.subdomain ? ` (subdomain: ${urlParts.subdomain})` : ''}`,
    urlParts.pathSegments.length ? `Path segments: ${urlParts.pathSegments.join(' / ')}` : null,
    Object.keys(urlParts.query).length ? `Query keys: ${Object.keys(urlParts.query).join(', ')}` : null,
    `Title: ${ctx.title || '(none)'}`,
    heuristic ? `Heuristic type: ${heuristic.type}; features: ${(heuristic.features || []).join(', ') || 'none'}` : null,
    ctx.domSummary ? `DOM landmarks:\n${ctx.domSummary}` : null,
    ctx.text ? `Visible text excerpt:\n${ctx.text.slice(0, 1200)}` : null
  ].filter(Boolean).join('\n');

  const messages = [
    {
      role: 'system',
      content:
        'You classify web pages for a browser agent. Given signals about the current page, ' +
        'respond with ONLY a compact JSON object — no prose, no code fences — of the form:\n' +
        '{"kind":"<short page kind, e.g. blog article, social feed, video list, search results, ' +
        'product page, web app, login, documentation, dashboard, form>",' +
        '"interface":"<one sentence describing the interface the user is looking at and what it affords>",' +
        '"primaryContent":"<what the main content of the page is>",' +
        '"suggestedApproach":"<one short sentence on how an agent should act on this kind of page>"}'
    },
    { role: 'user', content: signals }
  ];

  const res = await adapter.complete({
    model: settings.model || 'gpt-4o-mini',
    messages,
    maxTokens: 220,
    temperature: 0
  });

  const raw = (res?.content || '').trim();
  // Be tolerant: strip accidental code fences, then pull the first {...} block.
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return {
      kind: parsed.kind || null,
      interface: parsed.interface || null,
      primaryContent: parsed.primaryContent || null,
      suggestedApproach: parsed.suggestedApproach || null,
      heuristicType: heuristic?.type || null,
      features: heuristic?.features || []
    };
  } catch {
    return null;
  }
};

// Run the deterministic classifyPage handler in the content script for cheap,
// structured signals (page type + feature flags) to feed the AI classifier.
const runHeuristicClassify = async (sendToContentScript) => {
  try {
    return await sendToContentScript('CLASSIFY_PAGE');
  } catch {
    return null;
  }
};

// Visual layout pass — screenshot the page and have the vision model describe,
// in prose, the spatial layout and where the key controls live (inputs, forms,
// search box, sidebar/nav, main content, composer). This gives the agent a
// human-like "glance at the page" at the start of the session. Runs once per
// session alongside classification; entirely best-effort.
const analyzeVisualLayout = async (adapter, { settings, captureVisual }) => {
  if (typeof captureVisual !== 'function' || typeof adapter.describeImage !== 'function') return null;
  let imageBase64;
  try {
    imageBase64 = await captureVisual();
  } catch {
    return null;
  }
  if (!imageBase64) return null;

  const prompt =
    'You are orienting a browser agent at the start of a session. Look at this web page ' +
    'screenshot and describe its visual LAYOUT in 3-5 sentences of plain prose. Focus on ' +
    'where the key interactive areas are, so the agent knows what it is looking at: identify ' +
    'any search box, primary input field(s) or form, a text composer/editor, navigation bar, ' +
    'left/right sidebar, the main content column, and any modal or cookie banner currently ' +
    'covering the page. Describe positions relative to each other (top/left/center/right). ' +
    'Do NOT invent CSS selectors and do NOT list every element — just give a clear spatial ' +
    'overview of the interface and its main controls.';

  try {
    const res = await adapter.describeImage({
      imageBase64,
      prompt,
      ...(settings.visionModel ? { model: settings.visionModel } : {})
    });
    return res?.description?.trim() || null;
  } catch {
    return null;
  }
};

// Top-level enrichment. Returns { urlParts, pageProfile } to merge into the raw
// page context before building the agent message. classification (the AI call)
// runs at most once per session; URL decomposition runs every turn.
//
// deps:
//   adapter            — a lemura adapter exposing complete()/describeImage()
//   settings           — current settings (model, etc.)
//   sendToContentScript— bound dispatcher for content-script actions
//   captureVisual      — async () => base64 screenshot of the viewport, or null
export const prepareContext = async (ctx, { adapter, settings, sendToContentScript, captureVisual } = {}) => {
  const urlParts = decomposeUrl(ctx?.url || '');

  // Reuse the cached profile for the rest of the session.
  if (_sessionProfile) {
    return { urlParts, pageProfile: _sessionProfile };
  }

  // First turn of the session — classify once and take a single visual layout
  // glance. Failures are non-fatal: we still return URL parts so context
  // enrichment degrades gracefully. The two passes are independent, so run them
  // in parallel to keep first-turn latency down.
  let pageProfile = null;
  if (adapter && settings) {
    try {
      const heuristic = await runHeuristicClassify(sendToContentScript);
      const [classification, visualLayout] = await Promise.all([
        classifyPageWithAI(adapter, { settings, urlParts, ctx, heuristic }),
        analyzeVisualLayout(adapter, { settings, captureVisual })
      ]);
      if (classification || visualLayout) {
        pageProfile = { ...(classification || {}), visualLayout: visualLayout || null };
      }
    } catch {
      pageProfile = null;
    }
  }

  // Cache whatever we got (including null) so we don't retry the LLM call every
  // turn if classification failed once. A fresh session resets this.
  _sessionProfile = pageProfile;
  return { urlParts, pageProfile };
};
