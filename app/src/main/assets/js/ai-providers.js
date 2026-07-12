window.EyePlusAI = (function() {

const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    models: [
      { id: 'meta-llama/llama-3.2-3b-instruct:free', name: 'Llama 3.2 3B', free: true },
      { id: 'google/gemma-2-9b-it:free', name: 'Gemma 2 9B', free: true },
      { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B', free: true },
      { id: 'qwen/qwen-2.5-7b-instruct:free', name: 'Qwen 2.5 7B', free: true },
      { id: 'microsoft/phi-3-mini-128k-instruct:free', name: 'Phi-3 Mini', free: true },
      { id: 'nousresearch/nous-capybara-7b:free', name: 'Nous Capybara 7B', free: true },
      { id: 'openchat/openchat-7b:free', name: 'OpenChat 7B', free: true },
    ],
    buildBody(messages, model) {
      return { model, messages, max_tokens: 1024 };
    },
    buildHeaders(apiKey) {
      return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': 'https://eyeplus.app' };
    },
    parseResponse(data) {
      return data.choices?.[0]?.message?.content || '';
    }
  },

  huggingface: {
    name: 'HuggingFace',
    endpoint: 'https://api-inference.huggingface.co/models/',
    models: [
      { id: 'mistralai/Mistral-7B-Instruct-v0.3', name: 'Mistral 7B', free: true },
      { id: 'meta-llama/Llama-3.2-3B-Instruct', name: 'Llama 3.2 3B', free: true },
      { id: 'Qwen/Qwen2.5-7B-Instruct', name: 'Qwen 2.5 7B', free: true },
      { id: 'google/gemma-2-2b-it', name: 'Gemma 2 2B', free: true },
      { id: 'microsoft/Phi-3-mini-4k-instruct', name: 'Phi-3 Mini', free: true },
    ],
    buildBody(messages, model) {
      const lastMsg = messages[messages.length - 1];
      return { inputs: lastMsg.content, parameters: { max_new_tokens: 512 } };
    },
    buildHeaders(apiKey) {
      return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    },
    getEndpoint(model) {
      return this.endpoint + model;
    },
    parseResponse(data) {
      if (Array.isArray(data)) return data[0]?.generated_text || '';
      return data.generated_text || JSON.stringify(data);
    }
  },

  gemini: {
    name: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
    models: [
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', free: true },
      { id: 'gemini-1.5-flash-lite', name: 'Gemini Flash Lite', free: true },
    ],
    buildBody(messages, model) {
      const contents = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
      const sysMsg = messages.find(m => m.role === 'system');
      const body = { contents };
      if (sysMsg) body.systemInstruction = { parts: [{ text: sysMsg.content }] };
      return body;
    },
    getEndpoint(model, apiKey) {
      return `${this.endpoint}${model}:generateContent?key=${apiKey}`;
    },
    buildHeaders() {
      return { 'Content-Type': 'application/json' };
    },
    parseResponse(data) {
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
  },

  groq: {
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    models: [
      { id: 'llama3-8b-8192', name: 'Llama 3 8B', free: true },
      { id: 'llama3-70b-8192', name: 'Llama 3 70B', free: true },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', free: true },
      { id: 'gemma2-9b-it', name: 'Gemma2 9B', free: true },
      { id: 'whisper-large-v3', name: 'Whisper STT', free: true, type: 'stt' },
    ],
    buildBody(messages, model) {
      return { model, messages, max_tokens: 1024 };
    },
    buildHeaders(apiKey) {
      return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    },
    parseResponse(data) {
      return data.choices?.[0]?.message?.content || '';
    },
    async transcribe(apiKey, audioBlob) {
      const fd = new FormData();
      fd.append('file', audioBlob, 'audio.wav');
      fd.append('model', 'whisper-large-v3');
      fd.append('language', 'cs');
      const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: fd
      });
      const d = await r.json();
      return d.text || '';
    }
  },

  together: {
    name: 'Together.ai',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    models: [
      { id: 'meta-llama/Llama-3-8b-chat-hf', name: 'Llama 3 8B', free: true, credit: true },
      { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', name: 'Mixtral 8x7B', free: true, credit: true },
      { id: 'NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO', name: 'Nous Hermes 2', free: true, credit: true },
    ],
    buildBody(messages, model) { return { model, messages, max_tokens: 1024 }; },
    buildHeaders(apiKey) { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }; },
    parseResponse(data) { return data.choices?.[0]?.message?.content || ''; }
  },

  cohere: {
    name: 'Cohere',
    endpoint: 'https://api.cohere.ai/v1/chat',
    models: [
      { id: 'command-r', name: 'Command R', free: true },
      { id: 'command-r-plus', name: 'Command R+', free: true },
    ],
    buildBody(messages, model) {
      const sysMsg = messages.find(m => m.role === 'system');
      const chatHistory = messages.filter(m => m.role !== 'system' && m !== messages[messages.length - 1]);
      const lastMsg = messages[messages.length - 1];
      return {
        model, message: lastMsg?.content || '',
        chat_history: chatHistory.map(m => ({ role: m.role === 'assistant' ? 'CHATBOT' : 'USER', message: m.content })),
        preamble: sysMsg?.content || ''
      };
    },
    buildHeaders(apiKey) { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }; },
    parseResponse(data) { return data.text || ''; }
  },

  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', free: true, credit: true },
      { id: 'deepseek-coder', name: 'DeepSeek Coder', free: true, credit: true },
    ],
    buildBody(messages, model) { return { model, messages, max_tokens: 1024 }; },
    buildHeaders(apiKey) { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }; },
    parseResponse(data) { return data.choices?.[0]?.message?.content || ''; }
  },

  mistral: {
    name: 'Mistral AI',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    models: [
      { id: 'mistral-tiny-latest', name: 'Mistral Tiny', free: true },
      { id: 'mistral-small-latest', name: 'Mistral Small', free: true },
      { id: 'mistral-medium-latest', name: 'Mistral Medium', free: true },
    ],
    buildBody(messages, model) { return { model, messages, max_tokens: 1024 }; },
    buildHeaders(apiKey) { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }; },
    parseResponse(data) { return data.choices?.[0]?.message?.content || ''; }
  },

  cloudflare: {
    name: 'Cloudflare Workers AI',
    endpoint: 'https://api.cloudflare.com/client/v4/accounts/',
    models: [
      { id: '@cf/meta/llama-3.2-3b-instruct', name: 'Llama 3.2 3B', free: true },
      { id: '@cf/mistral/mistral-7b-instruct-v0.2', name: 'Mistral 7B', free: true },
    ],
    buildBody(messages, model) {
      const lastMsg = messages[messages.length - 1];
      return { messages: messages.map(m => ({ role: m.role, content: m.content })), stream: false };
    },
    getEndpoint(model, apiKey, accountId) {
      const accId = accountId || localStorage.getItem('cf_account_id') || '';
      return `https://api.cloudflare.com/client/v4/accounts/${accId}/ai/run/${model}`;
    },
    buildHeaders(apiKey) { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }; },
    parseResponse(data) { return data.result?.response || ''; }
  },

  sambanova: {
    name: 'SambaNova',
    endpoint: 'https://api.sambanova.ai/v1/chat/completions',
    models: [
      { id: 'Meta-Llama-3.1-8B-Instruct', name: 'Llama 3.1 8B', free: true },
      { id: 'Meta-Llama-3.1-405B-Instruct', name: 'Llama 3.1 405B', free: true },
    ],
    buildBody(messages, model) { return { model, messages, max_tokens: 1024, temperature: 0.7 }; },
    buildHeaders(apiKey) { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }; },
    parseResponse(data) { return data.choices?.[0]?.message?.content || ''; }
  },

  novita: {
    name: 'Novita AI',
    endpoint: 'https://api.novita.ai/v3/openai/chat/completions',
    models: [
      { id: 'meta-llama/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', free: true },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', free: true },
    ],
    buildBody(messages, model) { return { model, messages, max_tokens: 1024 }; },
    buildHeaders(apiKey) { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }; },
    parseResponse(data) { return data.choices?.[0]?.message?.content || ''; }
  },

  chutes: {
    name: 'Chutes AI',
    endpoint: 'https://api.chutes.ai/v1/chat/completions',
    models: [
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1', free: true },
      { id: 'meta-llama/Llama-3.2-3B-Instruct', name: 'Llama 3.2 3B', free: true },
    ],
    buildBody(messages, model) { return { model, messages, max_tokens: 1024 }; },
    buildHeaders(apiKey) { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }; },
    parseResponse(data) { return data.choices?.[0]?.message?.content || ''; }
  }
};

let DEFAULT_API_KEYS = {};

async function loadConfig() {
  try {
    const r = await fetch('config.json');
    if (r.ok) {
      const cfg = await r.json();
      if (cfg.api_keys) DEFAULT_API_KEYS = cfg.api_keys;
    }
  } catch(e) {}
}

loadConfig();

const SYSTEM_PROMPT = `Jsi EYES - AI asistent Security kamery EYEPLUS.
Umis:
- Popisovat co kamera vidi
- Odpovidat na otazky o stavu kamery
- Pomahat s ovladanim PTZ (pan/tilt/zoom)
- Hlasit podezrele aktivity
- Odpovidat v jazyce uzivatele (cesky/slovensky/anglicky)
Odpovid kratce a strucne. Pokud nevidis zadny obraz, rekni to.`;

function getSettings() {
  return JSON.parse(localStorage.getItem('eyeplus_settings') || '{}');
}

function saveSettings(s) {
  localStorage.setItem('eyeplus_settings', JSON.stringify(s));
}

function getActiveProvider() {
  const s = getSettings();
  return s.ai_provider || 'openrouter';
}

function getActiveModel() {
  const s = getSettings();
  return s.ai_model || PROVIDERS[getActiveProvider()]?.models[0]?.id || '';
}

function getApiKey(provider) {
  const s = getSettings();
  return s[`${provider}_api_key`] || DEFAULT_API_KEYS[provider] || '';
}

async function chat(messages, opts = {}) {
  const providerName = opts.provider || getActiveProvider();
  const model = opts.model || getActiveModel();
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error('Neznamy provider: ' + providerName);

  const apiKey = getApiKey(providerName);
  if (!apiKey) throw new Error(`Chybi API klic pro ${provider.name}. Nastav ho v Nastaveni.`);

  const fullMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages
  ];

  const url = provider.getEndpoint ? provider.getEndpoint(model, apiKey) : provider.endpoint;
  const body = provider.buildBody(fullMessages, model);
  const headers = provider.buildHeaders(apiKey);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts.signal
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${provider.name} chyba ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  return provider.parseResponse(data);
}

async function analyzeFrame(base64Frame, question, opts = {}) {
  const providerName = opts.provider || getActiveProvider();
  const model = opts.model || getActiveModel();
  const provider = PROVIDERS[providerName];
  const apiKey = getApiKey(providerName);

  if (!apiKey) throw new Error('Chybi API klic');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Kamera prave vidi tento snimek. Popis co vidis, pripadne odpovaz na otazku: ${question || 'Popis co vidi kamera.'}` }
  ];

  if (providerName === 'gemini') {
    const url = provider.getEndpoint(model, apiKey);
    const body = {
      contents: [{ role: 'user', parts: [
        { text: messages[1].content },
        { inlineData: { mimeType: 'image/jpeg', data: base64Frame } }
      ]}],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }
    };
    const r = await fetch(url, { method: 'POST', headers: provider.buildHeaders(), body: JSON.stringify(body) });
    const d = await r.json();
    return provider.parseResponse(d);
  }

  const fullMessages = [
    { role: 'user', content: [
      { type: 'text', text: messages[1].content },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Frame}` } }
    ]}
  ];

  const body = { model, messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...fullMessages], max_tokens: 1024 };
  const r = await fetch(provider.endpoint, { method: 'POST', headers: provider.buildHeaders(apiKey), body: JSON.stringify(body) });
  const d = await r.json();
  return provider.parseResponse(d);
}

async function transcribeAudio(audioBlob) {
  const s = getSettings();

  if (s.ai_provider === 'groq' || !s.ai_provider) {
    const groqKey = getApiKey('groq');
    if (groqKey) {
      const fd = new FormData();
      fd.append('file', audioBlob, 'audio.wav');
      fd.append('model', 'whisper-large-v3');
      fd.append('language', 'cs');
      const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${groqKey}` }, body: fd
      });
      const d = await r.json();
      if (d.text) return d.text;
    }
  }

  if (s.stt_provider === 'openrouter') {
    const key = getApiKey('openrouter');
    if (key) {
      const fd = new FormData();
      fd.append('file', audioBlob, 'audio.wav');
      fd.append('model', 'openai/whisper-1');
      const r = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${key}` }, body: fd
      });
      const d = await r.json();
      if (d.text) return d.text;
    }
  }

  throw new Error('Zadny STT provider neni nakonfigurovan. pridej Groq API klic v Nastaveni.');
}

function getAllProviders() {
  return Object.entries(PROVIDERS).map(([key, p]) => ({
    id: key,
    name: p.name,
    models: p.models.filter(m => m.free),
    hasSTT: p.models.some(m => m.type === 'stt')
  }));
}

function testProvider(providerName, apiKey) {
  const provider = PROVIDERS[providerName];
  if (!provider) return Promise.resolve(false);
  const model = provider.models[0]?.id;
  if (!model) return Promise.resolve(false);

  return chat([{ role: 'user', content: 'Ahoj, odpovz jednim slovem.' }], { provider: providerName, model })
    .then(r => !!r)
    .catch(() => false);
}

return {
  PROVIDERS,
  SYSTEM_PROMPT,
  chat,
  analyzeFrame,
  transcribeAudio,
  getAllProviders,
  getActiveProvider,
  getActiveModel,
  getApiKey,
  getSettings,
  saveSettings,
  testProvider
};

})();
