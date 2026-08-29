import { tasks, proposals } from '../db.js';

/**
 * What "approve" actually does, per proposal kind.
 *
 * Registering a channel here is the single place that grants the twin outward
 * reach. Until one is registered for a kind, approving prepares the action and
 * hands it back for the principal to send — deliberately, so an unconfigured
 * install can never surprise anyone.
 */
const executors = new Map();

export function registerExecutor(kind, fn) {
  executors.set(kind, fn);
}

// Self-contained: approving a proposed commitment simply records it.
registerExecutor('task', async (proposal) => {
  const payload = JSON.parse(proposal.payload || '{}');
  tasks.add({
    title: proposal.title,
    detail: payload.body ?? proposal.rationale,
    direction: payload.direction || 'mine',
    person: payload.person ?? null,
    due: payload.due ?? null,
    capture_id: proposal.capture_id,
  });
  return 'Added to your commitments.';
});

export async function approve(id) {
  const proposal = proposals.get(id);
  if (!proposal) return null;
  if (proposal.status !== 'pending') return proposal;

  const executor = executors.get(proposal.kind);
  if (!executor) {
    proposals.decide(id, 'approved',
      'Approved. No delivery channel is configured for this kind, so send it yourself — the draft is below.');
    return proposals.get(id);
  }
  try {
    const result = await executor(proposal);
    proposals.decide(id, 'executed', result ?? 'Done.');
  } catch (error) {
    proposals.decide(id, 'failed', error.message);
  }
  return proposals.get(id);
}

export function reject(id, reason = null) {
  const proposal = proposals.get(id);
  if (!proposal) return null;
  if (proposal.status === 'pending') proposals.decide(id, 'rejected', reason);
  return proposals.get(id);
}
