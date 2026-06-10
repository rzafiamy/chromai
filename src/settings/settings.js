import { getSettings, saveSettings } from '../sidebar/storage.js';

const form = document.getElementById('settings-form');
const statusMsg = document.getElementById('status-msg');
const mcpContainer = document.getElementById('mcp-servers-container');
const btnAddMcp = document.getElementById('btn-add-mcp');

// Sidebar panel navigation tabs
const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('.settings-section');

navItems.forEach(item => {
  item.addEventListener('click', () => {
    navItems.forEach(nav => nav.classList.remove('active'));
    sections.forEach(sec => sec.classList.remove('active'));

    item.classList.add('active');
    const sectionId = `section-${item.getAttribute('data-section')}`;
    document.getElementById(sectionId).classList.add('active');
  });
});

// Helper to create and insert an MCP server card in the DOM
function createMcpServerCard(config = { name: '', transport: 'http', url: '', headers: '', enabled: true, disabledTools: [] }) {
  const card = document.createElement('div');
  card.className = 'mcp-server-card';
  
  let headersStr = '';
  if (config.headers) {
    if (typeof config.headers === 'object') {
      headersStr = JSON.stringify(config.headers, null, 2);
    } else {
      headersStr = String(config.headers);
    }
  }

  card.innerHTML = `
    <div class="mcp-card-header">
      <h3>MCP Server</h3>
      <div style="display: flex; align-items: center; gap: 12px;">
        <label class="toggle" style="margin-bottom: 0;">
          <input type="checkbox" class="mcp-enabled" ${config.enabled !== false ? 'checked' : ''}>
          <span class="toggle-track"></span>
          <span style="font-size: 12px; font-weight: 500;">Enabled</span>
        </label>
        <button type="button" class="btn-remove-mcp">Remove</button>
      </div>
    </div>
    <div class="field-row" style="margin-bottom: 8px;">
      <div class="field" style="margin-bottom: 0;">
        <label>Server Name</label>
        <input type="text" class="mcp-name" placeholder="e.g. github" value="${config.name || ''}" required autocomplete="off">
      </div>
      <div class="field" style="margin-bottom: 0;">
        <label>Transport</label>
        <select class="mcp-transport">
          <option value="http" ${config.transport === 'http' ? 'selected' : ''}>HTTP POST</option>
          <option value="sse" ${config.transport === 'sse' ? 'selected' : ''}>SSE</option>
        </select>
      </div>
    </div>
    <div class="field" style="margin-bottom: 8px;">
      <label>Endpoint URL</label>
      <input type="url" class="mcp-url" placeholder="http://localhost:3001" value="${config.url || ''}" required autocomplete="off">
    </div>
    <div class="field" style="margin-bottom: 8px;">
      <label>Headers (JSON) <span class="optional">(optional)</span></label>
      <textarea class="mcp-headers" rows="2" placeholder='e.g. {"Authorization": "Bearer token"}' style="font-family: monospace; font-size: 12px;">${headersStr}</textarea>
    </div>
    <div class="field" style="margin-bottom: 0;">
      <label>Disabled Tools <span class="optional">(optional, comma-separated list to ignore)</span></label>
      <input type="text" class="mcp-disabled-tools" placeholder="e.g. web_search, fetch_url" value="${(config.disabledTools || []).join(', ')}" autocomplete="off">
    </div>
  `;

  card.querySelector('.btn-remove-mcp').addEventListener('click', () => {
    card.remove();
  });

  mcpContainer.appendChild(card);
}

// Load current settings into the form
getSettings().then(settings => {
  document.getElementById('baseUrl').value = settings.baseUrl || '';
  document.getElementById('apiKey').value = settings.apiKey || '';
  document.getElementById('model').value = settings.model || '';
  document.getElementById('systemPrompt').value = settings.systemPrompt || '';
  document.getElementById('visionModel').value = settings.visionModel || '';
  document.getElementById('asrUrl').value = settings.asrUrl || '';
  document.getElementById('maxIterations').value = settings.maxIterations ?? 15;
  document.getElementById('maxSteps').value = settings.maxSteps ?? 30;
  document.getElementById('maxCompletionTokens').value = settings.maxCompletionTokens ?? 4096;
  document.getElementById('maxTokensPerTool').value = settings.maxTokensPerTool ?? 4000;
  document.getElementById('contextWindow').value = settings.contextWindow ?? 128000;
  document.getElementById('requestTimeout').value = settings.requestTimeout ?? 120000;
  document.getElementById('visualContext').checked = settings.visualContext ?? false;
  document.getElementById('enableGoalPlanning').checked = settings.enableGoalPlanning ?? true;
  document.getElementById('enableContinuationPlanning').checked = settings.enableContinuationPlanning ?? false;
  document.getElementById('parallelToolCalls').checked = settings.parallelToolCalls ?? true;
  document.getElementById('goalInjectionFrequency').value = settings.goalInjectionFrequency ?? 'always';
  document.getElementById('goalInjectionPosition').value = settings.goalInjectionPosition ?? 'pre_turn';
  document.getElementById('enableGoalVerification').checked = settings.enableGoalVerification ?? false;
  document.getElementById('staticSystemPrompt').checked = settings.staticSystemPrompt ?? false;
  document.getElementById('temperature').value = settings.temperature ?? 0.0;
  document.getElementById('toolRegistryTimeoutMs').value = settings.toolRegistryTimeoutMs ?? 30000;
  document.getElementById('maxRetries').value = settings.maxRetries ?? 1;
  document.getElementById('baseDelayMs').value = settings.baseDelayMs ?? 1000;

  // Render loaded MCP servers
  if (settings.mcpServers && Array.isArray(settings.mcpServers)) {
    settings.mcpServers.forEach(srv => createMcpServerCard(srv));
  }
});

// Wire up Add button
btnAddMcp.addEventListener('click', () => {
  createMcpServerCard();
});

// ── Microphone permission UI ──
const micStatus = document.getElementById('mic-status');
const btnRequestMic = document.getElementById('btn-request-mic');

const updateMicStatus = (state) => {
  const labels = { granted: '✓ Granted', denied: '✗ Denied', prompt: 'Not yet granted' };
  const classes = { granted: 'granted', denied: 'denied', prompt: 'prompt' };
  micStatus.textContent = labels[state] ?? 'Unknown';
  micStatus.className = `mic-status ${classes[state] ?? ''}`;
  btnRequestMic.classList.toggle('hidden', state === 'granted');
};

if (navigator.permissions) {
  navigator.permissions.query({ name: 'microphone' }).then(result => {
    updateMicStatus(result.state);
    result.addEventListener('change', () => updateMicStatus(result.state));
  }).catch(() => updateMicStatus('prompt'));
} else {
  updateMicStatus('prompt');
}

btnRequestMic.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    updateMicStatus('granted');
  } catch {
    updateMicStatus('denied');
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Gather and validate MCP servers
  const mcpServers = [];
  const cards = document.querySelectorAll('.mcp-server-card');
  for (const card of cards) {
    const name = card.querySelector('.mcp-name').value.trim();
    const transport = card.querySelector('.mcp-transport').value;
    const url = card.querySelector('.mcp-url').value.trim();
    const headersRaw = card.querySelector('.mcp-headers').value.trim();
    const enabled = card.querySelector('.mcp-enabled').checked;
    const disabledToolsRaw = card.querySelector('.mcp-disabled-tools').value.trim();
    
    let headers = undefined;
    if (headersRaw) {
      try {
        headers = JSON.parse(headersRaw);
      } catch (err) {
        alert(`Invalid JSON in headers for MCP server "${name}". Please correct it.`);
        return;
      }
    }

    const disabledTools = disabledToolsRaw
      ? disabledToolsRaw.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    if (name && url) {
      mcpServers.push({
        name,
        transport,
        url,
        enabled,
        disabledTools,
        ...(headers ? { headers } : {})
      });
    }
  }

  await saveSettings({
    baseUrl: document.getElementById('baseUrl').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    model: document.getElementById('model').value.trim(),
    systemPrompt: document.getElementById('systemPrompt').value.trim(),
    visionModel: document.getElementById('visionModel').value.trim(),
    asrUrl: document.getElementById('asrUrl').value.trim(),
    maxIterations: parseInt(document.getElementById('maxIterations').value, 10) || 15,
    maxSteps: parseInt(document.getElementById('maxSteps').value, 10) || 30,
    maxCompletionTokens: parseInt(document.getElementById('maxCompletionTokens').value, 10) || 4096,
    maxTokensPerTool: parseInt(document.getElementById('maxTokensPerTool').value, 10) || 4000,
    contextWindow: parseInt(document.getElementById('contextWindow').value, 10) || 128000,
    requestTimeout: parseInt(document.getElementById('requestTimeout').value, 10) || 120000,
    visualContext: document.getElementById('visualContext').checked,
    enableGoalPlanning: document.getElementById('enableGoalPlanning').checked,
    enableContinuationPlanning: document.getElementById('enableContinuationPlanning').checked,
    parallelToolCalls: document.getElementById('parallelToolCalls').checked,
    goalInjectionFrequency: document.getElementById('goalInjectionFrequency').value,
    goalInjectionPosition: document.getElementById('goalInjectionPosition').value,
    enableGoalVerification: document.getElementById('enableGoalVerification').checked,
    staticSystemPrompt: document.getElementById('staticSystemPrompt').checked,
    temperature: parseFloat(document.getElementById('temperature').value) ?? 0.0,
    toolRegistryTimeoutMs: parseInt(document.getElementById('toolRegistryTimeoutMs').value, 10) || 30000,
    maxRetries: parseInt(document.getElementById('maxRetries').value, 10) ?? 1,
    baseDelayMs: parseInt(document.getElementById('baseDelayMs').value, 10) || 1000,
    mcpServers // Save the list of MCP servers!
  });

  statusMsg.classList.remove('hidden');
  setTimeout(() => statusMsg.classList.add('hidden'), 2500);
});
