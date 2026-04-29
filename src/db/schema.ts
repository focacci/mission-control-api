import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { MessagePart } from '../types/index.types.js';

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  emoji: text('emoji').notNull(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  focus: text('focus', {
    enum: ['sprint', 'steady', 'simmer', 'dormant'],
  })
    .notNull()
    .default('steady'),
  focusIcon: text('focus_icon').notNull(),
  timeline: text('timeline'),
  story: text('story'),
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const initiatives = sqliteTable('initiatives', {
  id: text('id').primaryKey(),
  emoji: text('emoji').notNull(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  status: text('status', {
    enum: ['active', 'backlog', 'paused', 'completed'],
  })
    .notNull()
    .default('active'),
  mission: text('mission'),
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const weekPlans = sqliteTable('week_plans', {
  id: text('id').primaryKey(),
  weekStart: text('week_start').notNull().unique(),
  weekEnd: text('week_end').notNull(),
  generatedAt: text('generated_at').notNull(),
  sprintSlots: integer('sprint_slots').notNull(),
  steadySlots: integer('steady_slots').notNull(),
  simmerSlots: integer('simmer_slots').notNull(),
  fixedSlots: integer('fixed_slots').notNull(),
  flexSlots: integer('flex_slots').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  initiativeId: text('initiative_id').references(() => initiatives.id, {
    onDelete: 'set null',
  }),
  status: text('status', {
    enum: ['pending', 'done'],
  })
    .notNull()
    .default('pending'),
  objective: text('objective').notNull(),
  summary: text('summary'),
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
});

export const taskRequirements = sqliteTable('task_requirements', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const requirementTests = sqliteTable('requirement_tests', {
  id: text('id').primaryKey(),
  requirementId: text('requirement_id')
    .notNull()
    .references(() => taskRequirements.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  passed: integer('passed', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  identityName: text('identity_name'),
  identityEmoji: text('identity_emoji'),
  workspace: text('workspace').notNull(),
  agentDir: text('agent_dir').notNull(),
  model: text('model'),
  bindings: integer('bindings').notNull().default(0),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  systemPrompt: text('system_prompt'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const agentAssignments = sqliteTable('agent_assignments', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'cascade' }),
  initiativeId: text('initiative_id').references(() => initiatives.id, {
    onDelete: 'cascade',
  }),
  taskId: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  status: text('status', {
    enum: ['pending', 'scheduled', 'in-progress', 'done', 'blocked'],
  })
    .notNull()
    .default('pending'),
  completedAt: text('completed_at'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const scheduleSlots = sqliteTable('schedule_slots', {
  id: text('id').primaryKey(),
  weekPlanId: text('week_plan_id')
    .notNull()
    .references(() => weekPlans.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  time: text('time').notNull(),
  datetime: text('datetime').notNull(),
  type: text('type', {
    enum: ['maintenance', 'planning', 'agent_assignment', 'brief', 'flex'],
  })
    .notNull()
    .default('flex'),
  status: text('status', {
    enum: ['pending', 'in-progress', 'done', 'skipped'],
  })
    .notNull()
    .default('pending'),
  agentAssignmentId: text('agent_assignment_id').references(
    () => agentAssignments.id,
    { onDelete: 'set null' },
  ),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  note: text('note'),
  extraPrompt: text('extra_prompt'),
  dayOfWeek: text('day_of_week').notNull(),
});

export const slotOutputs = sqliteTable('slot_outputs', {
  id: text('id').primaryKey(),
  slotId: text('slot_id')
    .notNull()
    .references(() => scheduleSlots.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  url: text('url'),
  kind: text('kind', { enum: ['created', 'updated', 'deleted'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const weekGoalAllocations = sqliteTable('week_goal_allocations', {
  id: text('id').primaryKey(),
  weekPlanId: text('week_plan_id')
    .notNull()
    .references(() => weekPlans.id, { onDelete: 'cascade' }),
  goalId: text('goal_id')
    .notNull()
    .references(() => goals.id, { onDelete: 'cascade' }),
  targetSlots: integer('target_slots').notNull(),
  assignedSlots: integer('assigned_slots').notNull().default(0),
});

export const chatSessions = sqliteTable('chat_sessions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  contextType: text('context_type'),
  contextId: text('context_id'),
  title: text('title'),
  createdAt: text('created_at').notNull(),
  lastMessageAt: text('last_message_at').notNull(),
});

export const agentInvocations = sqliteTable('agent_invocations', {
  id: text('id').primaryKey(),
  trigger: text('trigger', {
    enum: ['slot_start', 'brief', 'user_chat', 'manual'],
  }).notNull(),
  triggerRefId: text('trigger_ref_id'),
  agentId: text('agent_id').notNull(),
  sessionId: text('session_id').notNull(),
  status: text('status', {
    enum: ['running', 'complete', 'error', 'timeout', 'cancelled'],
  })
    .notNull()
    .default('running'),
  model: text('model').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  error: text('error'),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  gatewayRunId: text('gateway_run_id'),
});

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  invocationId: text('invocation_id'),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  // Plain-text fallback retained for one release per MCP_TOOLKIT_PLAN Bucket 2a;
  // `parts` is the structured source of truth that newer clients render.
  content: text('content').notNull(),
  parts: text('parts', { mode: 'json' }).$type<MessagePart[]>(),
  sortOrder: integer('sort_order').notNull(),
  createdAt: text('created_at').notNull(),
});

export const profileSections = sqliteTable('profile_sections', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  icon: text('icon').notNull(),
  summary: text('summary'),
  sortOrder: integer('sort_order').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

export const profileEntries = sqliteTable('profile_entries', {
  id: text('id').primaryKey(),
  sectionId: text('section_id')
    .notNull()
    .references(() => profileSections.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  detail: text('detail'),
  confidence: text('confidence', { enum: ['observed', 'inferred', 'stated'] })
    .notNull()
    .default('observed'),
  source: text('source'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const pinnedContexts = sqliteTable('pinned_contexts', {
  id: text('id').primaryKey(),
  contextType: text('context_type').notNull(),
  contextId: text('context_id'),
  label: text('label').notNull(),
  icon: text('icon').notNull(),
  typeName: text('type_name').notNull(),
  payload: text('payload'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const contextGroups = sqliteTable('context_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('point.3.connected.trianglepath.dotted'),
  summary: text('summary'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const contextGroupMembers = sqliteTable('context_group_members', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => contextGroups.id, { onDelete: 'cascade' }),
  contextType: text('context_type').notNull(),
  contextId: text('context_id'),
  label: text('label').notNull(),
  icon: text('icon').notNull(),
  typeName: text('type_name').notNull(),
  payload: text('payload'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const briefs = sqliteTable(
  'briefs',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    kind: text('kind', { enum: ['morning', 'afternoon', 'evening'] }).notNull(),
    status: text('status', {
      enum: ['pending', 'drafting', 'ready', 'acknowledged', 'error'],
    })
      .notNull()
      .default('pending'),
    title: text('title'),
    // JSON-serialized BriefBody (see types/index.types.ts). Plain freeform text
    // is still accepted for hand-authored briefs and the legacy fallback path.
    body: text('body'),
    // JSON-serialized BriefReferences index for "which briefs touch X?" queries.
    references: text('references'),
    invocationId: text('invocation_id'),
    generatedAt: text('generated_at'),
    revealAt: text('reveal_at'),
    windowStart: text('window_start'),
    windowEnd: text('window_end'),
    acknowledgedAt: text('acknowledged_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  table => ({
    dateKindUnique: uniqueIndex('briefs_date_kind_unique').on(table.date, table.kind),
  }),
);

export const agentOutputs = sqliteTable('agent_outputs', {
  id: text('id').primaryKey(),
  agentAssignmentId: text('agent_assignment_id')
    .notNull()
    .references(() => agentAssignments.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  status: text('status', {
    enum: ['running', 'complete', 'error', 'cancelled'],
  })
    .notNull()
    .default('running'),
  input: text('input').notNull(),
  response: text('response'),
  model: text('model'),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  error: text('error'),
});

export const agentOutputSteps = sqliteTable('agent_output_steps', {
  id: text('id').primaryKey(),
  outputId: text('output_id')
    .notNull()
    .references(() => agentOutputs.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['thinking', 'tool_call', 'text'] }).notNull(),
  content: text('content'),
  toolName: text('tool_name'),
  toolInput: text('tool_input'),
  toolOutput: text('tool_output'),
  isError: integer('is_error', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  durationMs: integer('duration_ms'),
});

// Bucket 2b interface tools (render_card, suggest_replies, navigate, attach,
// ...) execute inside the stdio MCP server — a separate process from the
// in-process runner that owns the chat_messages write path. This queue
// bridges the two: the dispatcher inserts a part row when an interface tool
// is called; the runner drains rows for the in-flight invocation when it
// flushes the assistant buffer and merges them into the resulting
// chat_messages.parts list.
export const pendingMessageParts = sqliteTable('pending_message_parts', {
  id: text('id').primaryKey(),
  invocationId: text('invocation_id').notNull(),
  sessionId: text('session_id').notNull(),
  part: text('part', { mode: 'json' }).$type<MessagePart>().notNull(),
  sortOrder: integer('sort_order').notNull(),
  createdAt: text('created_at').notNull(),
});

export const toolCallLog = sqliteTable('tool_call_log', {
  id: text('id').primaryKey(),
  messageId: text('message_id').references(() => chatMessages.id, { onDelete: 'cascade' }),
  invocationId: text('invocation_id').notNull(),
  toolName: text('tool_name').notNull(),
  input: text('input').notNull(),
  output: text('output'),
  isError: integer('is_error', { mode: 'boolean' }).notNull().default(false),
  summary: text('summary'),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  durationMs: integer('duration_ms'),
});
