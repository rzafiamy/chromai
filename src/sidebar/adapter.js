// OpenAI-compatible provider adapter for lemura.
// Uses browser fetch() — no CORS issues from an extension origin.

function toOpenAIMessages(messages) {
  return messages.map(msg => {
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      return {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string'
              ? tc.arguments
              : JSON.stringify(tc.arguments)
          }
        }))
      };
    }
    if (msg.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: msg.toolCallId || msg.name,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      };
    }
    return { role: msg.role, content: msg.content || '' };
  });
}

function mapFinishReason(r) {
  if (!r) return 'stop';
  const v = r.toLowerCase();
  if (v === 'tool_calls') return 'tool_call';
  if (v === 'length' || v === 'max_tokens') return 'max_tokens';
  return 'stop';
}

function buildToolsPayload(tools) {
  if (!tools?.length) return {};
  return {
    tools: tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters || { type: 'object', properties: {} }
      }
    })),
    tool_choice: 'auto'
  };
}

// getSettings is a function called lazily each request so config changes are picked up
export function buildAdapter(getSettings) {
  return {
    name: 'chromai_openai_compat',
    version: '1.0.0',

    async complete(request) {
      const { baseUrl, apiKey, model } = getSettings();
      const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

      const body = {
        model: request.model || model || 'gpt-4o-mini',
        messages: toOpenAIMessages(request.messages),
        ...(request.maxTokens && { max_tokens: request.maxTokens }),
        ...(request.temperature !== undefined && { temperature: request.temperature }),
        ...buildToolsPayload(request.tools)
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { Authorization: `Bearer ${apiKey}` })
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`API ${res.status}: ${err?.error?.message || res.statusText}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      if (!choice) throw new Error('No choices in API response');

      const msg = choice.message;
      return {
        content: msg.content || '',
        toolCalls: msg.tool_calls?.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments
        })),
        finishReason: mapFinishReason(choice.finish_reason),
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0
        }
      };
    },

    async *stream(request) {
      const { baseUrl, apiKey, model } = getSettings();
      const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { Authorization: `Bearer ${apiKey}` })
        },
        body: JSON.stringify({
          model: request.model || model,
          messages: toOpenAIMessages(request.messages),
          stream: true,
          ...buildToolsPayload(request.tools)
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`API ${res.status}: ${err?.error?.message || res.statusText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (json === '[DONE]') {
            yield { delta: '', finished: true, finishReason: 'stop' };
            return;
          }
          try {
            const chunk = JSON.parse(json);
            const delta = chunk.choices?.[0]?.delta;
            const finishReason = chunk.choices?.[0]?.finish_reason;
            yield {
              delta: delta?.content || '',
              finished: finishReason != null,
              finishReason: mapFinishReason(finishReason)
            };
          } catch { /* skip malformed chunks */ }
        }
      }
    },

    estimateTokens(text) {
      const str = typeof text === 'string' ? text : JSON.stringify(text);
      return Math.ceil(str.length / 4);
    },

    getModelInfo() {
      return {
        supportsVision: false,
        supportsTools: true,
        contextWindow: 128000
      };
    },

    async healthCheck() {
      return true;
    }
  };
}
