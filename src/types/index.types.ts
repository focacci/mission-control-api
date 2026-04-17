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
  return new Date().toISOString().slice(0, 10);
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
  emoji: z.string().optional(), // manual override; otherwise derived from initiative/goal
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
