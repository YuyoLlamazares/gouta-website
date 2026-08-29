import { think, textOf } from '../claude.js';
import { systemPrompt, contextBlock } from './prompts.js';
import { captures, proposals, counts } from '../db.js';

/**
 * The one screen worth reading in the morning: what is waiting, what is owed,
 * and what the twin thinks matters today.
 */
export async function morningBrief() {
  const pending = proposals.pending();
  const recent = captures.recent(15);

  const response = await think({
    system: systemPrompt('briefing'),
    effort: 'medium',
    maxTokens: 2000,
    messages: [{
      role: 'user',
      content: `${contextBlock({ limit: 40 })}

<awaiting_approval>
${pending.length ? pending.map((p) => `- [${p.id}] ${p.title}`).join('\n') : 'Nothing.'}
</awaiting_approval>

<recent_captures>
${recent.length ? recent.map((c) => `- ${c.summary || c.body.slice(0, 100)}`).join('\n') : 'Nothing.'}
</recent_captures>

Write today's brief. Speak to your principal directly, second person, no
greeting and no sign-off. At most 150 words, in this shape:

**Today.** The one or two things that actually matter, and why.
**Waiting on you.** Approvals and decisions only they can make.
**Slipping.** Anything overdue or going quiet. Omit this line if nothing is.

If there is genuinely nothing to report, say so in one sentence. Do not pad.`,
    }],
  });

  return { text: textOf(response), counts: counts() };
}
