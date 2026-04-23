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
});

export const UpdateTaskSchema = z.object({
  name: z.string().min(1).optional(),
  objective: z.string().min(1).optional(),
  status: z.enum(['pending', 'in-progress', 'done', 'blocked', 'cancelled']).optional(),
  sortOrder: z.number().int().optional(),
});

export const DoneTaskSchema = z.object({
  summary: z.string().min(1),
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

// Requirement tests
export const AddRequirementTestSchema = z.object({
  description: z.string().min(1),
});

export const UpdateRequirementTestSchema = z.object({
  description: z.string().min(1).optional(),
  passed: z.boolean().optional(),
});

// Agent Assignments
export const CreateAgentAssignmentSchema = z.object({
  title: z.string().min(1),
  instructions: z.string().min(1),
  agentId: z.string().nullable().optional(),
});

export const UpdateAgentAssignmentSchema = z.object({
  title: z.string().min(1).optional(),
  instructions: z.string().min(1).optional(),
  agentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

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
export type BlockTaskInput = z.infer<typeof BlockTaskSchema>;
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
