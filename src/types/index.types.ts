import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FOCUS_ICONS = {
  sprint: '🔵',
  steady: '🟢',
  simmer: '🟡',
  dormant: '⚪️',
} as const;

export const FOCUS_ORDER = {
  sprint: 0,
  steady: 1,
  simmer: 2,
  dormant: 3,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const APP_TZ: string = process.env.APP_TZ ?? 'America/New_York';

export function now(): string {
  return new Date().toISOString();
}

export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ }).format(new Date());
}

/**
 * The current wall-clock instant in `APP_TZ`, formatted three ways:
 *   - `date`     = "YYYY-MM-DD"
 *   - `time`     = "HH:mm"
 *   - `datetime` = "YYYY-MM-DDTHH:mm" (matches `scheduleSlots.datetime`)
 */
export function nowLocalParts(): { date: string; time: string; datetime: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;
  let hour = lookup.hour ?? '00';
  if (hour === '24') hour = '00';
  const date = `${lookup.year}-${lookup.month}-${lookup.day}`;
  const time = `${hour}:${lookup.minute}`;
  return { date, time, datetime: `${date}T${time}` };
}

/** Convenience: returns `nowLocalParts().datetime`. */
export function nowLocalDatetime(): string {
  return nowLocalParts().datetime;
}

/**
 * Add `n` days to a YYYY-MM-DD string. Pure UTC math — independent of server
 * TZ and DST.
 */
export function addDaysISO(baseDate: string, n: number): string {
  const [y, m, d] = baseDate.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Return the YYYY-MM-DD of the Sunday on or before `dateStr` (defaults to
 * `today()`). Uses pure UTC math on the calendar date — independent of server
 * TZ.
 */
export function getSundayOf(dateStr?: string): string {
  const base = dateStr ?? today();
  const [y, m, d] = base.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const day = utc.getUTCDay();
  return addDaysISO(base, -day);
}

export function deriveDisplayName(emoji: string, name: string): string {
  return `${emoji} ${name}`;
}

// ---------------------------------------------------------------------------
// AppError — thrown by services, caught by route handlers
// ---------------------------------------------------------------------------

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFound(entity: string, id: string): AppError {
  return new AppError(404, `${entity} not found: ${id}`);
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

// Goals
export const CreateGoalSchema = z.object({
  emoji: z.string().min(1),
  name: z.string().min(1),
  focus: z.enum(['sprint', 'steady', 'simmer', 'dormant']).optional().default('steady'),
  timeline: z.string().optional(),
  story: z.string().optional(),
});

export const UpdateGoalSchema = z.object({
  emoji: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  focus: z.enum(['sprint', 'steady', 'simmer', 'dormant']).optional(),
  timeline: z.string().nullable().optional(),
  story: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

// Initiatives
export const CreateInitiativeSchema = z.object({
  emoji: z.string().min(1),
  name: z.string().min(1),
  goalId: z.string().optional(),
  mission: z.string().optional(),
  status: z.enum(['active', 'backlog', 'paused', 'completed']).optional().default('active'),
});

export const UpdateInitiativeSchema = z.object({
  emoji: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  status: z.enum(['active', 'backlog', 'paused', 'completed']).optional(),
  mission: z.string().nullable().optional(),
  goalId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

// Tasks
export const CreateTaskSchema = z.object({
  name: z.string().min(1),
  initiativeId: z.string().optional(),
  objective: z.string().min(1),
  requirements: z.array(z.string().min(1)).optional().default([]),
});

export const UpdateTaskSchema = z.object({
  name: z.string().min(1).optional(),
  objective: z.string().min(1).optional(),
  status: z.enum(['pending', 'done']).optional(),
  sortOrder: z.number().int().optional(),
});

export const DoneTaskSchema = z.object({
  summary: z.string().min(1),
});

// Requirements
export const AddRequirementSchema = z.object({
  description: z.string().min(1),
});

export const UpdateRequirementSchema = z.object({
  description: z.string().min(1).optional(),
  completed: z.boolean().optional(),
});

// Requirement tests
export const AddRequirementTestSchema = z.object({
  description: z.string().min(1),
});

export const UpdateRequirementTestSchema = z.object({
  description: z.string().min(1).optional(),
  passed: z.boolean().optional(),
});

// Agent Assignments
export const AGENT_ASSIGNMENT_STATUSES = [
  'pending',
  'scheduled',
  'in-progress',
  'done',
  'blocked',
] as const;

export const CreateAgentAssignmentSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
});

export const UpdateAgentAssignmentSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const BlockAgentAssignmentSchema = z.object({
  reason: z.string().min(1).optional(),
});

// Agent Outputs
export const AGENT_OUTPUT_STATUSES = ['running', 'complete', 'error', 'cancelled'] as const;
export type AgentOutputStatus = (typeof AGENT_OUTPUT_STATUSES)[number];

export const AGENT_OUTPUT_STEP_KINDS = ['thinking', 'tool_call', 'text'] as const;
export type AgentOutputStepKind = (typeof AGENT_OUTPUT_STEP_KINDS)[number];

export const CreateAgentOutputSchema = z.object({
  agentId: z.string().nullable().optional(),
  input: z.string().min(1),
  model: z.string().nullable().optional(),
});
export type CreateAgentOutputInput = z.infer<typeof CreateAgentOutputSchema>;

export const AppendAgentOutputStepSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('thinking'),
    content: z.string(),
  }),
  z.object({
    kind: z.literal('text'),
    content: z.string(),
  }),
  z.object({
    kind: z.literal('tool_call'),
    toolName: z.string().min(1),
    toolInput: z.unknown(),
    toolOutput: z.string().nullable().optional(),
    isError: z.boolean().optional(),
    durationMs: z.number().int().nonnegative().optional(),
  }),
]);
export type AppendAgentOutputStepInput = z.infer<typeof AppendAgentOutputStepSchema>;

export const CompleteAgentOutputSchema = z.object({
  response: z.string(),
  tokensIn: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative().default(0),
});
export type CompleteAgentOutputInput = z.infer<typeof CompleteAgentOutputSchema>;

export const FailAgentOutputSchema = z.object({
  error: z.string().min(1),
  status: z.enum(['error', 'cancelled']).default('error'),
});
export type FailAgentOutputInput = z.infer<typeof FailAgentOutputSchema>;

// Slot Outputs
export const AddSlotOutputSchema = z.object({
  label: z.string().min(1),
  url: z.string().optional(),
  kind: z.enum(['created', 'updated', 'deleted']),
});

// Schedule
export const GenerateWeekPlanSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const UpdateSlotSchema = z.object({
  status: z.enum(['pending', 'in-progress', 'done', 'skipped']).optional(),
  agentAssignmentId: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  extraPrompt: z.string().nullable().optional(),
});

export const DoneSlotSchema = z.object({
  note: z.string().optional(),
});

export const SkipSlotSchema = z.object({
  reason: z.string().optional(),
});

export const AssignAgentAssignmentSchema = z.object({
  agentAssignmentId: z.string().min(1),
  slotId: z.string().min(1),
});

// Agents
export const CreateAgentSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().optional(),
});

export const UpdateAgentSchema = z.object({
  systemPrompt: z.string().nullable().optional(),
});

// Chat
export const ChatContextSchema = z.object({
  type: z.string().min(1),
  id: z.string().optional(),
  name: z.string().optional(),
  emoji: z.string().optional(),
  section: z.string().optional(),
  date: z.string().optional(),
});

export const ChatRequestSchema = z.object({
  message: z.string().min(1),
  agentId: z.string().optional(),
  context: ChatContextSchema.optional(),
  sessionId: z.string().optional(),
});

// Message parts — structured render schema for chat_messages.parts
// (MCP_TOOLKIT_PLAN Bucket 2a). Each assistant or user turn is a list of parts;
// the iOS client switches on `kind` to pick a renderer. Bucket 2b interface
// tools (render_card, prompt_user, navigate, attach, ...) emit additional
// parts onto the in-flight assistant message.
export const CARD_KINDS = [
  'task',
  'goal',
  'initiative',
  'agent_assignment',
  'slot',
  'schedule_day',
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const PROMPT_KINDS = ['confirm', 'choice'] as const;
export type PromptKind = (typeof PROMPT_KINDS)[number];

export const TextPartSchema = z.object({
  kind: z.literal('text'),
  text: z.string(),
});

export const CardPartSchema = z.object({
  kind: z.literal('card'),
  cardType: z.enum(CARD_KINDS),
  entityId: z.string().min(1),
});

export const PromptPartSchema = z.object({
  kind: z.literal('prompt'),
  promptType: z.enum(PROMPT_KINDS),
  question: z.string().min(1),
  promptId: z.string().min(1),
  choices: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        emoji: z.string().optional(),
      }),
    )
    .optional(),
});

export const PromptReplyPartSchema = z.object({
  kind: z.literal('prompt_reply'),
  promptId: z.string().min(1),
  choiceId: z.string().min(1),
});

export const QuickRepliesPartSchema = z.object({
  kind: z.literal('quick_replies'),
  suggestions: z.array(
    z.object({ id: z.string().min(1), label: z.string().min(1) }),
  ),
});

export const NavigatePartSchema = z.object({
  kind: z.literal('navigate'),
  route: z.string().min(1),
  label: z.string().min(1),
});

export const AttachmentPartSchema = z.object({
  kind: z.literal('attachment'),
  mimeType: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
  size: z.number().int().nonnegative().optional(),
});

export const LiveActivityRefPartSchema = z.object({
  kind: z.literal('live_activity_ref'),
  activityId: z.string().min(1),
  title: z.string().min(1),
});

export const MessagePartSchema = z.discriminatedUnion('kind', [
  TextPartSchema,
  CardPartSchema,
  PromptPartSchema,
  PromptReplyPartSchema,
  QuickRepliesPartSchema,
  NavigatePartSchema,
  AttachmentPartSchema,
  LiveActivityRefPartSchema,
]);

export type MessagePart = z.infer<typeof MessagePartSchema>;
export type TextPart = z.infer<typeof TextPartSchema>;

/** Concatenate every text-bearing part into a flat string. Used to derive the
 *  legacy `chat_messages.content` column from a `parts[]` payload, and to give
 *  pre-parts callers a stable string to log or display. */
export function partsToText(parts: MessagePart[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p.kind === 'text') out.push(p.text);
    else if (p.kind === 'navigate') out.push(p.label);
    else if (p.kind === 'prompt') out.push(p.question);
  }
  return out.join('\n').trim();
}

/** Wrap a plain-text body as a single-element parts list — the canonical
 *  fallback for legacy callers and for backfilling rows that pre-date Bucket 2a. */
export function textToParts(content: string): MessagePart[] {
  return [{ kind: 'text', text: content }];
}

// Conversations
export const CreateSessionSchema = z.object({
  agentId: z.string().min(1),
  contextType: z.string().nullable().optional(),
  contextId: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
});

export const ListSessionsQuerySchema = z.object({
  agentId: z.string().optional(),
  contextType: z.string().optional(),
  contextId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const ListMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  before: z.string().optional(),
});

// Invocations
export const INVOCATION_TRIGGERS = ['slot_start', 'brief', 'user_chat', 'manual'] as const;
export const INVOCATION_STATUSES = ['running', 'complete', 'error', 'timeout', 'cancelled'] as const;

export const ListInvocationsQuerySchema = z.object({
  trigger: z.enum(INVOCATION_TRIGGERS).optional(),
  status: z.enum(INVOCATION_STATUSES).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  since: z.string().optional(),
});

// Profile
export const PROFILE_CONFIDENCE = ['observed', 'inferred', 'stated'] as const;

export const UpdateProfileSectionSchema = z.object({
  summary: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const AddProfileEntrySchema = z.object({
  label: z.string().min(1),
  detail: z.string().nullable().optional(),
  confidence: z.enum(PROFILE_CONFIDENCE).optional(),
  source: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const UpdateProfileEntrySchema = z.object({
  label: z.string().min(1).optional(),
  detail: z.string().nullable().optional(),
  confidence: z.enum(PROFILE_CONFIDENCE).optional(),
  source: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

// Pinned contexts & context groups
const NewContextRefSchema = z.object({
  contextType: z.string().min(1),
  contextId: z.string().nullable().optional(),
  label: z.string().min(1),
  icon: z.string().min(1),
  typeName: z.string().min(1),
  payload: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const CreatePinnedContextSchema = NewContextRefSchema;

export const CreateContextGroupSchema = z.object({
  name: z.string().min(1),
  icon: z.string().min(1).optional(),
  summary: z.string().nullable().optional(),
  members: z.array(NewContextRefSchema).optional(),
});

export const UpdateContextGroupSchema = z.object({
  name: z.string().min(1).optional(),
  icon: z.string().min(1).optional(),
  summary: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const AddContextGroupMemberSchema = NewContextRefSchema;

// Briefings
export const BRIEF_KINDS = ['morning', 'afternoon', 'evening'] as const;
export const BRIEF_STATUSES = ['pending', 'generating', 'ready', 'error'] as const;

export const ListBriefsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const GenerateBriefSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(BRIEF_KINDS),
});

export const UpdateBriefSchema = z.object({
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  status: z.enum(BRIEF_STATUSES).optional(),
  references: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type CreateGoalInput = z.infer<typeof CreateGoalSchema>;
export type UpdateGoalInput = z.infer<typeof UpdateGoalSchema>;
export type CreateInitiativeInput = z.infer<typeof CreateInitiativeSchema>;
export type UpdateInitiativeInput = z.infer<typeof UpdateInitiativeSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
export type DoneTaskInput = z.infer<typeof DoneTaskSchema>;
export type GenerateWeekPlanInput = z.infer<typeof GenerateWeekPlanSchema>;
export type UpdateSlotInput = z.infer<typeof UpdateSlotSchema>;
export type DoneSlotInput = z.infer<typeof DoneSlotSchema>;
export type SkipSlotInput = z.infer<typeof SkipSlotSchema>;
export type AssignAgentAssignmentInput = z.infer<typeof AssignAgentAssignmentSchema>;
export type AddRequirementInput = z.infer<typeof AddRequirementSchema>;
export type UpdateRequirementInput = z.infer<typeof UpdateRequirementSchema>;
export type AddRequirementTestInput = z.infer<typeof AddRequirementTestSchema>;
export type UpdateRequirementTestInput = z.infer<typeof UpdateRequirementTestSchema>;
export type CreateAgentAssignmentInput = z.infer<typeof CreateAgentAssignmentSchema>;
export type UpdateAgentAssignmentInput = z.infer<typeof UpdateAgentAssignmentSchema>;
export type BlockAgentAssignmentInput = z.infer<typeof BlockAgentAssignmentSchema>;
export type AgentAssignmentStatus = (typeof AGENT_ASSIGNMENT_STATUSES)[number];
export type AddSlotOutputInput = z.infer<typeof AddSlotOutputSchema>;
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;
export type ChatContextInput = z.infer<typeof ChatContextSchema>;
export type ChatRequestInput = z.infer<typeof ChatRequestSchema>;
export type CreateSessionInputZ = z.infer<typeof CreateSessionSchema>;
export type ListSessionsQuery = z.infer<typeof ListSessionsQuerySchema>;
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;
export type ListInvocationsQuery = z.infer<typeof ListInvocationsQuerySchema>;
export type UpdateProfileSectionInput = z.infer<typeof UpdateProfileSectionSchema>;
export type AddProfileEntryInput = z.infer<typeof AddProfileEntrySchema>;
export type UpdateProfileEntryInput = z.infer<typeof UpdateProfileEntrySchema>;
export type CreatePinnedContextInput = z.infer<typeof CreatePinnedContextSchema>;
export type CreateContextGroupInput = z.infer<typeof CreateContextGroupSchema>;
export type UpdateContextGroupInput = z.infer<typeof UpdateContextGroupSchema>;
export type AddContextGroupMemberInput = z.infer<typeof AddContextGroupMemberSchema>;
export type ListBriefsQuery = z.infer<typeof ListBriefsQuerySchema>;
export type GenerateBriefInput = z.infer<typeof GenerateBriefSchema>;
export type UpdateBriefInput = z.infer<typeof UpdateBriefSchema>;
