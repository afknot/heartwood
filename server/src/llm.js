// One small interface over Claude, OpenAI and Gemini. Plain fetch, no SDKs.
import { config } from './config.js';
import { getSettings } from './db.js';

export class AIError extends Error {}

/**
 * @param {object} o
 * @param {string} o.system
 * @param {{role:'user'|'assistant', content:string, images?:{mime:string,data:string}[]}[]} o.messages
 *   images: base64 pictures attached to that message (vision).
 * @param {boolean} [o.json]  ask for a JSON object back (parsed)
 * @param {number}  [o.maxTokens]
 */
export async function complete({ system, messages, json = false, maxTokens = 6000 }) {
  const s = getSettings();
  const provider = s.ai_provider;
  const model = s.models?.[provider];
  if (!config.keys[provider]) throw new AIError(`No API key set for ${{ anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini' }[provider] || provider}. Add one in Settings → AI & transcription.`);
  if (!model) throw new AIError(`No model set for ${provider}.`);

  const sys = json
    ? `${system}\n\nRespond with a single valid JSON object only. No markdown fences, no commentary.`
    : system;

  const call = (msgs, budget) => {
    if (provider === 'anthropic') return anthropic(model, sys, msgs, budget);
    if (provider === 'openai') return openai(model, sys, msgs, budget, json);
    if (provider === 'gemini') return gemini(model, sys, msgs, budget, json);
    throw new AIError(`Unknown provider ${provider}`);
  };

  let { text, truncated } = await call(messages, maxTokens);
  if (!json) return text;
  try { return parseJson(text); } catch { /* recover below */ }

  // Long notes (many people, many follow-ups) can run past the length limit and get cut off
  // mid-JSON. Ask again with more room and a nudge to be brief; otherwise ask it to fix the format.
  const first = text;
  console.warn(`[ai] ${provider} JSON ${truncated ? 'cut off at the length limit' : 'did not parse'} (${text.length} chars); retrying`);
  const bigger = Math.min(16000, Math.round(maxTokens * (truncated ? 2 : 1.5)));
  const retry = truncated
    ? await call([...messages.slice(0, -1), { ...messages.at(-1), content: `${messages.at(-1).content}\n\n(Keep every field concise so the whole JSON object fits. Fewer, sharper items beat many.)` }], bigger)
    : await call([...messages, { role: 'assistant', content: text.slice(0, 20000) },
      { role: 'user', content: 'That was not valid JSON. Reply again with only the complete JSON object, no other text.' }], bigger);
  ({ text, truncated } = retry);
  try { return parseJson(text); } catch { /* salvage below */ }

  // Last resort: keep what arrived. A reflection missing its last section beats an error.
  const salvaged = repairJson(text) || repairJson(first);
  if (salvaged) { console.warn(`[ai] ${provider} used a repaired, possibly incomplete JSON reply`); return salvaged; }
  throw new AIError(truncated ? 'The AI reply was too long and got cut off. Try again, or split the note.' : 'The AI response was not valid JSON. Try again.');
}

async function post(url, headers, body, label) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5 * 60 * 1000)
  });
  const raw = await res.text();
  if (!res.ok) {
    let msg = raw.slice(0, 500);
    try { const j = JSON.parse(raw); msg = j.error?.message || j.message || msg; } catch {}
    throw new AIError(`${label} error ${res.status}: ${msg}`);
  }
  return JSON.parse(raw);
}

async function anthropic(model, system, messages, maxTokens) {
  const j = await post('https://api.anthropic.com/v1/messages', {
    'x-api-key': config.keys.anthropic,
    'anthropic-version': '2023-06-01'
  }, {
    model, max_tokens: maxTokens, system,
    messages: messages.map(m => m.images?.length ? {
      role: m.role,
      content: [
        ...m.images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })),
        { type: 'text', text: m.content }
      ]
    } : { role: m.role, content: m.content })
  }, 'Claude');
  return { text: (j.content || []).filter(b => b.type === 'text').map(b => b.text).join(''), truncated: j.stop_reason === 'max_tokens' };
}

async function openai(model, system, messages, maxTokens, json) {
  const body = {
    model,
    messages: [{ role: 'system', content: system }, ...messages.map(m => m.images?.length ? {
      role: m.role,
      content: [
        ...m.images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } })),
        { type: 'text', text: m.content }
      ]
    } : { role: m.role, content: m.content })],
    max_completion_tokens: maxTokens * 2 // reasoning models spend part of this budget thinking
  };
  if (json) body.response_format = { type: 'json_object' };
  const j = await post('https://api.openai.com/v1/chat/completions', {
    authorization: `Bearer ${config.keys.openai}`
  }, body, 'OpenAI');
  return { text: j.choices?.[0]?.message?.content || '', truncated: j.choices?.[0]?.finish_reason === 'length' };
}

async function gemini(model, system, messages, maxTokens, json) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [...(m.images || []).map(i => ({ inlineData: { mimeType: i.mime, data: i.data } })), { text: m.content }]
    })),
    generationConfig: { maxOutputTokens: maxTokens * 3 } // thinking tokens count against this
  };
  if (json) body.generationConfig.responseMimeType = 'application/json';
  const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    'x-goog-api-key': config.keys.gemini
  }, body, 'Gemini');
  const parts = j.candidates?.[0]?.content?.parts || [];
  return { text: parts.filter(p => p.text && !p.thought).map(p => p.text).join(''), truncated: j.candidates?.[0]?.finishReason === 'MAX_TOKENS' };
}

const unfence = text => String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
// Commas before a closing bracket are the most common slip.
const dropTrailingCommas = t => t.replace(/,(\s*[}\]])/g, '$1');

export function parseJson(text) {
  const t = unfence(text);
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  for (const c of [t, a >= 0 && b > a ? t.slice(a, b + 1) : null].filter(Boolean)) {
    try { return JSON.parse(c); } catch { /* try the next form */ }
    try { return JSON.parse(dropTrailingCommas(c)); } catch { /* try the next form */ }
  }
  throw new AIError('The AI response was not valid JSON. Try again.');
}

/**
 * Close a JSON object that was cut off partway: drop the unfinished last item and close every
 * open string, array and object. Returns the parsed object, or null if nothing usable is there.
 */
export function repairJson(text) {
  const t = unfence(text);
  const start = t.indexOf('{');
  if (start < 0) return null;
  const stack = [];
  const cuts = []; // places a value just ended inside a container: [index, closers]
  let inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') { stack.pop(); if (!stack.length) break; cuts.push([i + 1, stack.slice().reverse().join('')]); }
    else if (c === ',') cuts.push([i, stack.slice().reverse().join('')]);
  }
  // Try the longest prefix first.
  for (let k = cuts.length - 1; k >= 0 && k >= cuts.length - 60; k--) {
    const [at, closers] = cuts[k];
    try {
      const v = JSON.parse(dropTrailingCommas(t.slice(start, at) + closers));
      if (v && typeof v === 'object' && Object.keys(v).length) return v;
    } catch { /* cut further back */ }
  }
  return null;
}
