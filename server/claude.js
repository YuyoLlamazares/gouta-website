import Anthropic from '@anthropic-ai/sdk';
import { config, hasBrain } from './config.js';

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: config.apiKey, maxRetries: 3 });
  return client;
}

export class NoBrainError extends Error {
  constructor() {
    super('No ANTHROPIC_API_KEY set — the twin can store and serve, but not think. Add one to .env.');
    this.name = 'NoBrainError';
    this.status = 503;
  }
}

export class RefusalError extends Error {
  constructor(details) {
    super(`The model declined this request${details?.category ? ` (${details.category})` : ''}.`);
    this.name = 'RefusalError';
    this.status = 422;
  }
}

// Opus 5 runs adaptive thinking by default, and rejects temperature/top_p/top_k
// outright — so neither appears here. `fallbacks: "default"` re-runs a declined
// request on a fallback model inside the same call, which matters for an agent
// that works unattended in the background.
const BETAS = ['server-side-fallback-2026-07-01'];

export function buildRequest({ system, messages, tools, effort = 'high', maxTokens = 8000 }) {
  const request = {
    model: config.model,
    max_tokens: maxTokens,
    output_config: { effort },
    betas: BETAS,
    fallbacks: 'default',
    // The profile is the stable prefix of every request — cache it.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  };
  if (tools?.length) request.tools = tools;
  return request;
}

export async function think(options) {
  if (!hasBrain()) throw new NoBrainError();

  const response = await getClient().beta.messages.create(buildRequest(options));
  if (response.stop_reason === 'refusal') throw new RefusalError(response.stop_details);
  return response;
}

export const textOf = (response) =>
  response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

/**
 * Ask Claude for one structured object, described by a JSON schema.
 * Uses a strict tool as the schema carrier, with a text-JSON fallback in case
 * the model answers in prose instead of calling the tool.
 */
export async function extract({ system, prompt, name, description, schema, effort = 'medium' }) {
  const response = await think({
    system,
    effort,
    messages: [{ role: 'user', content: prompt }],
    tools: [{
      name,
      description,
      strict: true,
      input_schema: { ...schema, additionalProperties: false },
    }],
  });

  const call = response.content.find((b) => b.type === 'tool_use' && b.name === name);
  // Tool inputs may carry non-obvious JSON escaping — never string-match them.
  if (call) return call.input;

  const text = textOf(response);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  try {
    return JSON.parse(fenced ? fenced[1] : text);
  } catch {
    throw new Error(`Expected structured output from "${name}" but got prose: ${text.slice(0, 200)}`);
  }
}
