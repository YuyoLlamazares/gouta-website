import { think, textOf } from '../claude.js';
import { systemPrompt, contextBlock } from './prompts.js';
import { proposals } from '../db.js';

/**
 * Draft something in the principal's voice and put it in the approval queue.
 * Never returns a sent thing — only a pending proposal.
 */
export async function draft({ what, context = '', kind = 'draft', recipient = null }) {
  const response = await think({
    system: systemPrompt('drafting'),
    effort: 'high',
    maxTokens: 4000,
    messages: [{
      role: 'user',
      content: `${contextBlock({ query: recipient || what.slice(0, 60) })}

Write this in your principal's voice, ready to send verbatim.

<request>${what}</request>
${recipient ? `<recipient>${recipient}</recipient>` : ''}
${context ? `<context>\n${context}\n</context>` : ''}

Output only the draft itself — no preamble, no explanation, no subject line
unless it is an email. Where you would have to invent a fact, write
[TODO: ...] instead and keep going.`,
    }],
  });

  const body = textOf(response);
  const { lastInsertRowid } = proposals.add({
    kind,
    title: what.slice(0, 120),
    rationale: recipient ? `Draft for ${recipient}` : 'Requested draft',
    payload: { body, recipient },
  });

  return { id: Number(lastInsertRowid), body };
}
