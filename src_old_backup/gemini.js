const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function createClient() {
  const ollamaHost = process.env.OLLAMA_HOST || '';
  const customKey = process.env.CUSTOM_API_KEY || '';
  const customModel = process.env.CUSTOM_MODEL || 'big-pickle';
  const customBase = process.env.CUSTOM_BASE_URL || '';
  const groqKey = process.env.GROQ_API_KEY || '';
  const openRouterKey = process.env.OPENROUTER_API_KEY || '';
  const ghKey = process.env.GH_MODELS_KEY || process.env.GITHUB_TOKEN || '';

  let provider = 'github';
  let modelName = 'gpt-4o-mini'; // Default to gpt-4o-mini from GitHub Models
  let client = null;

  // 1) Try Ollama first (local)
  if (ollamaHost) {
    try {
      const r = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        provider = 'ollama';
        modelName = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
        console.log(`[AI] Using Ollama at ${ollamaHost} (${modelName})`);
      } else {
        console.log('[AI] Ollama not reachable');
      }
    } catch { console.log('[AI] Ollama not reachable'); }
  }

  // 2) Try Custom API (OpenCode Zen / OpenRouter / etc.)
  if (provider === 'github' && customKey && customBase) {
    try {
      const r = await fetch(`${customBase}/models`, {
        headers: { Authorization: `Bearer ${customKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        provider = 'custom';
        modelName = customModel;
        client = new OpenAI({ baseURL: customBase, apiKey: customKey });
        console.log(`[AI] Using custom API (${customBase}) — ${modelName}`);
      } else {
        console.log('[AI] Custom API key invalid');
      }
    } catch { console.log('[AI] Custom API not reachable'); }
  }

  // 3) Try GitHub Copilot (if OAuth token available from OpenCode auth store)
  // if (provider === 'github') {
  //   const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
  //   try {
  //     if (fs.existsSync(authPath)) {
  //       const authData = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  //       const copilot = authData['github-copilot'];
  //       if (copilot && copilot.access) {
  //         provider = 'github-copilot';
  //         modelName = 'claude-haiku-4.5';
  //         const copilotToken = copilot.access;
  //         console.log(`[AI] Using GitHub Copilot: ${modelName}`);
  //       }
  //     }
  //   } catch (e) { console.log(`[AI] GitHub Copilot auth error: ${e.message}`); }
  // }

  // 4) Try GitHub Models (free, reliable)
  if (provider === 'github' && ghKey) {
    try {
      const r = await fetch('https://models.inference.ai.azure.com/models', {
        headers: { Authorization: `Bearer ${ghKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        provider = 'github-models';
        client = new OpenAI({ baseURL: 'https://models.inference.ai.azure.com', apiKey: ghKey });
        console.log(`[AI] Using GitHub Models: ${modelName}`);
      } else {
        console.log('[AI] GitHub Models key invalid');
      }
    } catch { console.log('[AI] GitHub Models not reachable'); }
  }

  // 5) Try OpenRouter (free tier fallback)
  if (provider === 'github' && openRouterKey) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${openRouterKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        provider = 'openrouter';
        modelName = process.env.AI_MODEL || 'deepseek-chat';
        client = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: openRouterKey });
        console.log(`[AI] Using OpenRouter: ${modelName}`);
      } else {
        console.log('[AI] OpenRouter API key invalid');
      }
    } catch { console.log('[AI] OpenRouter not reachable'); }
  }

  // 6) Try Groq next (fast cloud)
  if (provider === 'github' && groqKey) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${groqKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        provider = 'groq';
        modelName = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
        client = new OpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey: groqKey });
        console.log(`[AI] Using Groq: ${modelName}`);
      } else {
        console.log('[AI] Groq API key invalid');
      }
    } catch { console.log('[AI] Groq not reachable'); }
  }

  // 7) Final fallback — no provider found
  if (provider === 'github') {
    console.error('ERROR: No working AI provider found. Check your .env keys.');
    process.exit(1);
  }

  let history = [];

  async function think(systemPrompt, context) {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: context },
    ];
    if (history.length > 0) {
      messages.push({ role: 'user', content: `## Recent History\n${history.slice(-3).join('\n')}` });
    }

    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        let response;
        if (provider === 'ollama') {
          const res = await fetch(`${ollamaHost}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: modelName, messages, stream: false,
              keep_alive: -1,
              options: { temperature: 0.5, num_predict: 128, top_p: 0.95, num_ctx: 2048 },
            }),
          });
          if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
          response = (await res.json()).message?.content?.trim() || '';
        } else {
          const completion = await client.chat.completions.create({
            model: modelName, messages, temperature: 0.5, max_tokens: 256, top_p: 0.95,
          });
          response = completion.choices[0]?.message?.content?.trim() || '';
        }

        if (response) {
          history.push(response.slice(0, 120));
          if (history.length > 16) history = history.slice(-12);
        }
        return response;
      } catch (err) {
        lastError = err;
        const backoff = [5000, 15000, 30000][attempt] || 30000;
        if (err.status === 429) { console.log(`[AI] Rate limited (attempt ${attempt + 1}), waiting ${backoff / 1000}s...`); await new Promise(r => setTimeout(r, backoff)); continue; }
        console.log(`[AI] Error: ${err.message}, retrying in ${backoff / 1000}s...`);
        await new Promise(r => setTimeout(r, backoff));
      }
    }
    throw lastError;
  }

  async function warmup() {
    if (provider === 'ollama') {
      console.log(`[AI] Warming up ${modelName}...`);
      const start = Date.now();
      try {
        await fetch(`${ollamaHost}/api/generate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelName, prompt: 'ok', stream: false }),
          signal: AbortSignal.timeout(120000),
        });
        console.log(`[AI] Model ready (${((Date.now() - start) / 1000).toFixed(1)}s)`);
      } catch (err) { console.log(`[AI] Warmup issue: ${err.message}`); }
    } else {
      console.log(`[AI] Using ${provider}: ${modelName}`);
    }
  }

  return { think, warmup };
}

module.exports = { createClient };
