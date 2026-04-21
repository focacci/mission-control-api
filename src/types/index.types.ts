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

export function now(): string {
  return new Date().toISOString();
}

export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
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
  tests: z.array(z.string().min(1)).optional().default([]),
});

export const UpdateTaskSchema = z.object({
  name: z.string().min(1).optional(),
  objective: z.string().min(1).optional(),
  status: z.enum(['pending', 'assigned', 'in-progress', 'done', 'blocked', 'cancelled']).optional(),
  sortOrder: z.number().int().optional(),
});

export const DoneTaskSchema = z.object({
  summary: z.string().min(1),
  outputs: z
    .array(z.object({ label: z.string().min(1), url: z.string().optional() }))
    .nullable()
    .optional()
    .default([]),
});

export const BlockTaskSchema = z.object({
  reason: z.string().min(1),
});

// Requirements
export const AddRequirementSchema = z.object({
  description: z.string().min(1),
});

export const UpdateRequirementSchema = z.object({
  description: z.string().min(1).optional(),
  completed: z.boolean().optional(),
});

// Tests
export const AddTestSchema = z.object({
  description: z.string().min(1),
});

export const UpdateTestSchema = z.object({
  description: z.string().min(1).optional(),
  passed: z.boolean().optional(),
});

// Outputs
export const AddOutputSchema = z.object({
  label: z.string().min(1),
  url: z.string().optional(),
});

// Schedule
export const GenerateWeekPlanSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const UpdateSlotSchema = z.object({
  status: z.enum(['pending', 'in-progress', 'done', 'skipped']).optional(),
  taskId: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const DoneSlotSchema = z.object({
  note: z.string().optional(),
});

export const SkipSlotSchema = z.object({
  reason: z.string().optional(),
});

export const AssignTaskSchema = z.object({
  taskId: z.string().min(1),
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
export type BlockTaskInput = z.infer<typeof BlockTaskSchema>;
export type GenerateWeekPlanInput = z.infer<typeof GenerateWeekPlanSchema>;
export type UpdateSlotInput = z.infer<typeof UpdateSlotSchema>;
export type DoneSlotInput = z.infer<typeof DoneSlotSchema>;
export type SkipSlotInput = z.infer<typeof SkipSlotSchema>;
export type AssignTaskInput = z.infer<typeof AssignTaskSchema>;
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;
export type ChatContextInput = z.infer<typeof ChatContextSchema>;
export type ChatRequestInput = z.infer<typeof ChatRequestSchema>;
export type CreateSessionInputZ = z.infer<typeof CreateSessionSchema>;
export type ListSessionsQuery = z.infer<typeof ListSessionsQuerySchema>;
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;
export type ListInvocationsQuery = z.infer<typeof ListInvocationsQuerySchema>;
