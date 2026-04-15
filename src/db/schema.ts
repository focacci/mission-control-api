import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

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

export const scheduleSlots = sqliteTable('schedule_slots', {
  id: text('id').primaryKey(),
  weekPlanId: text('week_plan_id')
    .notNull()
    .references(() => weekPlans.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  time: text('time').notNull(),
  datetime: text('datetime').notNull(),
  type: text('type', {
    enum: ['maintenance', 'planning', 'task', 'brief', 'flex'],
  })
    .notNull()
    .default('flex'),
  status: text('status', {
    enum: ['pending', 'in-progress', 'done', 'skipped'],
  })
    .notNull()
    .default('pending'),
  taskId: text('task_id'),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  note: text('note'),
  dayOfWeek: text('day_of_week').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  emoji: text('emoji').notNull(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  initiativeId: text('initiative_id').references(() => initiatives.id, {
    onDelete: 'set null',
  }),
  status: text('status', {
    enum: ['pending', 'assigned', 'in-progress', 'done', 'blocked', 'cancelled'],
  })
    .notNull()
    .default('pending'),
  objective: text('objective').notNull(),
  summary: text('summary'),
  slotId: text('slot_id').references(() => scheduleSlots.id, {
    onDelete: 'set null',
  }),
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

export const taskTests = sqliteTable('task_tests', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  passed: integer('passed', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const taskOutputs = sqliteTable('task_outputs', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  url: text('url'),
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
