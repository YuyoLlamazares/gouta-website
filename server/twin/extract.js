import { extract } from '../claude.js';
import { systemPrompt, contextBlock } from './prompts.js';
import { captures, memory, tasks, proposals } from '../db.js';
import { TRIAGE_SCHEMA } from './schema.js';

/**
 * Turn one raw capture into structured state. Everything outward-facing lands
 * in the approval queue; memory and tasks are internal and land directly.
 */
export async function triage(capture) {
  const result = await extract({
    system: systemPrompt('triage'),
    name: 'file_capture',
    description: 'File a captured note into memory, commitments, and proposed actions.',
    schema: TRIAGE_SCHEMA,
    effort: 'medium',
    prompt: `${contextBlock({ query: capture.body.slice(0, 60) })}

Your principal just captured this from their phone.

<capture kind="${capture.kind}" source="${capture.source}">
${capture.body}
</capture>

File it. Be conservative: record only durable facts, only real commitments, and
propose an outward action only when the capture plainly calls for one. An empty
array is the right answer more often than not.`,
  });

  for (const m of result.memories ?? []) {
    memory.add({ ...m, capture_id: capture.id });
  }
  for (const t of result.tasks ?? []) {
    tasks.add({ ...t, capture_id: capture.id });
  }
  for (const p of result.proposals ?? []) {
    proposals.add({
      kind: p.kind,
      title: p.title,
      rationale: p.rationale,
      payload: { body: p.body },
      capture_id: capture.id,
    });
  }
  captures.markProcessed(capture.id, result.summary ?? null);

  return {
    summary: result.summary ?? null,
    counts: {
      memories: result.memories?.length ?? 0,
      tasks: result.tasks?.length ?? 0,
      proposals: result.proposals?.length ?? 0,
    },
  };
}
