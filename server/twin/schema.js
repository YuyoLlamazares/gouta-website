// The contract between the twin and the database: what a filed capture becomes.
// Strict tools require additionalProperties:false and every property in `required`,
// so optional fields are expressed as nullable instead of omitted.

const nullableString = { type: ['string', 'null'] };

export const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'memories', 'tasks', 'proposals'],
  properties: {
    summary: { type: 'string', description: 'One line, under 15 words, in the principal\'s voice.' },
    memories: {
      type: 'array',
      description: 'Durable facts worth remembering. Skip anything ephemeral.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'content', 'subject'],
        properties: {
          kind: { type: 'string', enum: ['fact', 'preference', 'person', 'project'] },
          content: { type: 'string' },
          subject: { ...nullableString, description: 'Person or project this concerns.' },
        },
      },
    },
    tasks: {
      type: 'array',
      description: 'Commitments in either direction. Only real obligations, not vague intentions.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'direction', 'person', 'due'],
        properties: {
          title: { type: 'string' },
          detail: nullableString,
          direction: { type: 'string', enum: ['mine', 'theirs'] },
          person: nullableString,
          due: { ...nullableString, description: 'YYYY-MM-DD, or null if none was stated.' },
        },
      },
    },
    proposals: {
      type: 'array',
      description: 'Outward actions to offer for approval. Empty unless the capture clearly calls for one.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'rationale', 'body'],
        properties: {
          kind: { type: 'string', enum: ['email_reply', 'draft', 'task'] },
          title: { type: 'string', description: 'What tapping approve would do.' },
          rationale: { type: 'string', description: 'One sentence: why this is worth their attention.' },
          body: { type: 'string', description: 'The full draft, ready to send verbatim, in their voice.' },
        },
      },
    },
  },
};
