import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import { AppError, today } from '../types/index.types.js';
import * as goalsService from '../services/goals.service.js';
import * as initiativesService from '../services/initiatives.service.js';
import * as tasksService from '../services/tasks.service.js';
import * as requirementsService from '../services/requirements.service.js';
import * as aaService from '../services/agentAssignments.service.js';
import * as scheduleService from '../services/schedule.service.js';
import * as boardService from '../services/board.service.js';

// ---------------------------------------------------------------------------
// Coarse-grained tool definitions (one tool per domain aggregate).
// Local LLMs have limited context for tool schemas, so each tool dispatches
// to multiple underlying service actions via an "action" discriminator.
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'board',
    description:
      'Read-only overview of the entire system. Returns all goals with nested initiatives and tasks, stats, and the current week schedule summary. Call this first to understand the current state before making changes.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'goals',
    description:
      'Manage goals (top-level objectives with focus levels). Actions: list, get, create, update, delete.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'delete'],
          description: 'Operation to perform.',
        },
        id: { type: 'string', description: 'Goal ID (required for get/update/delete).' },
        emoji: { type: 'string', description: 'Emoji for create/update.' },
        name: { type: 'string', description: 'Goal name for create/update.' },
        focus: {
          type: 'string',
          enum: ['sprint', 'steady', 'simmer', 'dormant'],
          description: 'Focus level. For list: filters results. For create/update: sets level.',
        },
        timeline: { type: 'string', description: 'Timeline string (null to clear on update).' },
        story: { type: 'string', description: 'Narrative context (null to clear on update).' },
        sortOrder: { type: 'number', description: 'Sort position (update only).' },
      },
      required: ['action'],
    },
  },
  {
    name: 'initiatives',
    description:
      'Manage initiatives (actionable projects under goals). Actions: list, get, create, update, complete, delete.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'complete', 'delete'],
          description: 'Operation to perform.',
        },
        id: { type: 'string', description: 'Initiative ID (required for get/update/complete/delete).' },
        goalId: { type: 'string', description: 'Parent goal ID. For list: filters. For create/update: links.' },
        emoji: { type: 'string', description: 'Emoji for create/update.' },
        name: { type: 'string', description: 'Name for create/update.' },
        mission: { type: 'string', description: 'Mission statement (null to clear on update).' },
        status: {
          type: 'string',
          enum: ['active', 'backlog', 'paused', 'completed'],
          description: 'Status filter (list) or value (create/update).',
        },
        sortOrder: { type: 'number', description: 'Sort position (update only).' },
      },
      required: ['action'],
    },
  },
  {
    name: 'tasks',
    description:
      'Manage tasks (human-owned work). Actions: list, get, create, update, start, complete, block, cancel, delete. Requirements and agent assignments live on their own tools.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'list', 'get', 'create', 'update', 'start', 'complete', 'block', 'cancel', 'delete',
          ],
          description: 'Operation to perform.',
        },
        id: { type: 'string', description: 'Task ID (required for most actions except list/create).' },
        initiativeId: { type: 'string', description: 'Parent initiative ID. For list: filter. For create: link.' },
        name: { type: 'string', description: 'Task name (create/update).' },
        objective: { type: 'string', description: 'Definition of done (create/update).' },
        status: {
          type: 'string',
          enum: ['pending', 'in-progress', 'done', 'blocked', 'cancelled'],
          description: 'Status filter (list) or value (update).',
        },
        sortOrder: { type: 'number', description: 'Sort position (update only).' },
        summary: { type: 'string', description: 'Completion summary (complete action).' },
        reason: { type: 'string', description: 'Block reason (block action).' },
        requirements: {
          type: 'array',
          items: { type: 'string' },
          description: 'Initial requirements (create only).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'requirements',
    description:
      'Manage task requirements and their tests. Actions: add, update, check, uncheck, delete, add_test, update_test, pass_test, unpass_test, delete_test.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'add', 'update', 'check', 'uncheck', 'delete',
            'add_test', 'update_test', 'pass_test', 'unpass_test', 'delete_test',
          ],
          description: 'Operation to perform.',
        },
        taskId: { type: 'string', description: 'Parent task ID (required for add).' },
        reqId: { type: 'string', description: 'Requirement ID (required for non-add actions).' },
        testId: { type: 'string', description: 'Test ID (required for *_test actions except add_test).' },
        description: { type: 'string', description: 'Description for add/update.' },
        completed: { type: 'boolean', description: 'Requirement completed state (update).' },
        passed: { type: 'boolean', description: 'Test passed state (update_test).' },
      },
      required: ['action'],
    },
  },
  {
    name: 'agent_assignments',
    description:
      'Manage agent assignments (discrete agent work under a task). Actions: list, get, create, update, complete, delete.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'complete', 'delete'],
          description: 'Operation to perform.',
        },
        id: { type: 'string', description: 'Agent assignment ID (required for get/update/complete/delete).' },
        taskId: { type: 'string', description: 'Parent task ID (required for list/create).' },
        title: { type: 'string', description: 'Short label (create/update).' },
        instructions: { type: 'string', description: 'Instructions for the agent (create/update).' },
        agentId: { type: 'string', description: 'Agent to bind (create/update; null to clear).' },
        sortOrder: { type: 'number', description: 'Sort position (update only).' },
      },
      required: ['action'],
    },
  },
  {
    name: 'schedule',
    description:
      'Manage the weekly schedule. Actions: today, week, generate, assign, unassign, done, skip, update, add_output, delete_output.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'today', 'week', 'generate', 'assign', 'unassign',
            'done', 'skip', 'update', 'add_output', 'delete_output',
          ],
          description: 'Operation to perform.',
        },
        slotId: { type: 'string', description: 'Slot ID (required for most mutating actions).' },
        agentAssignmentId: {
          type: 'string',
          description: 'Agent assignment ID (assign action, or null to clear in update).',
        },
        weekStart: {
          type: 'string',
          description: 'Date in target week, YYYY-MM-DD (week/generate actions; defaults to current week).',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in-progress', 'done', 'skipped'],
          description: 'Slot status (update action).',
        },
        note: { type: 'string', description: 'Note for done/update actions.' },
        reason: { type: 'string', description: 'Reason for skip action.' },
        label: { type: 'string', description: 'Output label (add_output).' },
        url: { type: 'string', description: 'Output URL (add_output).' },
        kind: {
          type: 'string',
          enum: ['created', 'updated', 'deleted'],
          description: 'Output kind (add_output).',
        },
        outputId: { type: 'string', description: 'Output ID (delete_output).' },
      },
      required: ['action'],
    },
  },
  {
    name: 'health',
    description: 'Quick health check. Returns API status and goal count.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
] as const;

// ---------------------------------------------------------------------------
// Dispatch helpers
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>;

function requireArg<T>(args: Args, key: string, label?: string): T {
  const val = args[key];
  if (val === undefined || val === null) {
    throw new AppError(400, `Missing required field: ${label ?? key}`);
  }
  return val as T;
}

function optArg<T>(args: Args, key: string): T | undefined {
  return args[key] as T | undefined;
}

// ---------------------------------------------------------------------------
// Domain dispatchers
// ---------------------------------------------------------------------------

async function dispatchGoals(action: string, args: Args): Promise<unknown> {
  switch (action) {
    case 'list':
      return goalsService.listGoals({ focus: optArg<string>(args, 'focus') });
    case 'get':
      return goalsService.getGoal(requireArg<string>(args, 'id'));
    case 'create':
      return goalsService.createGoal({
        emoji: requireArg<string>(args, 'emoji'),
        name: requireArg<string>(args, 'name'),
        focus: (optArg<string>(args, 'focus') as 'sprint' | 'steady' | 'simmer' | 'dormant' | undefined) ?? 'steady',
        timeline: optArg<string>(args, 'timeline'),
        story: optArg<string>(args, 'story'),
      });
    case 'update':
      return goalsService.updateGoal(requireArg<string>(args, 'id'), {
        emoji: optArg<string>(args, 'emoji'),
        name: optArg<string>(args, 'name'),
        focus: optArg<string>(args, 'focus') as 'sprint' | 'steady' | 'simmer' | 'dormant' | undefined,
        timeline: optArg<string | null>(args, 'timeline'),
        story: optArg<string | null>(args, 'story'),
        sortOrder: optArg<number>(args, 'sortOrder'),
      });
    case 'delete':
      await goalsService.deleteGoal(requireArg<string>(args, 'id'));
      return { deleted: true };
    default:
      throw new AppError(400, `Unknown goals action: ${action}`);
  }
}

async function dispatchInitiatives(action: string, args: Args): Promise<unknown> {
  switch (action) {
    case 'list':
      return initiativesService.listInitiatives({
        goalId: optArg<string>(args, 'goalId'),
        status: optArg<string>(args, 'status'),
      });
    case 'get':
      return initiativesService.getInitiative(requireArg<string>(args, 'id'));
    case 'create':
      return initiativesService.createInitiative({
        emoji: requireArg<string>(args, 'emoji'),
        name: requireArg<string>(args, 'name'),
        goalId: optArg<string>(args, 'goalId'),
        mission: optArg<string>(args, 'mission'),
        status: (optArg<string>(args, 'status') as 'active' | 'backlog' | 'paused' | 'completed' | undefined) ?? 'active',
      });
    case 'update':
      return initiativesService.updateInitiative(requireArg<string>(args, 'id'), {
        emoji: optArg<string>(args, 'emoji'),
        name: optArg<string>(args, 'name'),
        status: optArg<string>(args, 'status') as 'active' | 'backlog' | 'paused' | 'completed' | undefined,
        mission: optArg<string | null>(args, 'mission'),
        goalId: optArg<string | null>(args, 'goalId'),
        sortOrder: optArg<number>(args, 'sortOrder'),
      });
    case 'complete':
      return initiativesService.completeInitiative(requireArg<string>(args, 'id'));
    case 'delete':
      await initiativesService.deleteInitiative(requireArg<string>(args, 'id'));
      return { deleted: true };
    default:
      throw new AppError(400, `Unknown initiatives action: ${action}`);
  }
}

async function dispatchTasks(action: string, args: Args): Promise<unknown> {
  switch (action) {
    case 'list':
      return tasksService.listTasks({
        initiativeId: optArg<string>(args, 'initiativeId'),
        status: optArg<string | string[]>(args, 'status'),
      });
    case 'get':
      return tasksService.getTask(requireArg<string>(args, 'id'));
    case 'create':
      return tasksService.createTask({
        name: requireArg<string>(args, 'name'),
        objective: requireArg<string>(args, 'objective'),
        initiativeId: optArg<string>(args, 'initiativeId'),
        requirements: optArg<string[]>(args, 'requirements') ?? [],
      });
    case 'update':
      return tasksService.updateTask(requireArg<string>(args, 'id'), {
        name: optArg<string>(args, 'name'),
        objective: optArg<string>(args, 'objective'),
        status: optArg<string>(args, 'status') as any,
        sortOrder: optArg<number>(args, 'sortOrder'),
      });
    case 'start':
      return tasksService.startTask(requireArg<string>(args, 'id'));
    case 'complete':
      return tasksService.doneTask(requireArg<string>(args, 'id'), {
        summary: requireArg<string>(args, 'summary'),
      });
    case 'block':
      return tasksService.blockTask(requireArg<string>(args, 'id'), {
        reason: requireArg<string>(args, 'reason'),
      });
    case 'cancel':
      return tasksService.cancelTask(requireArg<string>(args, 'id'));
    case 'delete':
      await tasksService.deleteTask(requireArg<string>(args, 'id'));
      return { deleted: true };
    default:
      throw new AppError(400, `Unknown tasks action: ${action}`);
  }
}

async function dispatchRequirements(action: string, args: Args): Promise<unknown> {
  switch (action) {
    case 'add':
      return requirementsService.addRequirement(
        requireArg<string>(args, 'taskId'),
        requireArg<string>(args, 'description'),
      );
    case 'update':
      return requirementsService.updateRequirement(requireArg<string>(args, 'reqId'), {
        description: optArg<string>(args, 'description'),
        completed: optArg<boolean>(args, 'completed'),
      });
    case 'check':
      return requirementsService.checkRequirement(requireArg<string>(args, 'reqId'), true);
    case 'uncheck':
      return requirementsService.checkRequirement(requireArg<string>(args, 'reqId'), false);
    case 'delete':
      await requirementsService.deleteRequirement(requireArg<string>(args, 'reqId'));
      return { deleted: true };
    case 'add_test':
      return requirementsService.addRequirementTest(
        requireArg<string>(args, 'reqId'),
        requireArg<string>(args, 'description'),
      );
    case 'update_test':
      return requirementsService.updateRequirementTest(
        requireArg<string>(args, 'reqId'),
        requireArg<string>(args, 'testId'),
        {
          description: optArg<string>(args, 'description'),
          passed: optArg<boolean>(args, 'passed'),
        },
      );
    case 'pass_test':
      return requirementsService.passRequirementTest(
        requireArg<string>(args, 'reqId'),
        requireArg<string>(args, 'testId'),
      );
    case 'unpass_test':
      return requirementsService.unpassRequirementTest(
        requireArg<string>(args, 'reqId'),
        requireArg<string>(args, 'testId'),
      );
    case 'delete_test':
      await requirementsService.deleteRequirementTest(
        requireArg<string>(args, 'reqId'),
        requireArg<string>(args, 'testId'),
      );
      return { deleted: true };
    default:
      throw new AppError(400, `Unknown requirements action: ${action}`);
  }
}

async function dispatchAgentAssignments(action: string, args: Args): Promise<unknown> {
  switch (action) {
    case 'list':
      return aaService.listAgentAssignmentsForTask(requireArg<string>(args, 'taskId'));
    case 'get':
      return aaService.getAgentAssignment(requireArg<string>(args, 'id'));
    case 'create':
      return aaService.createAgentAssignment(requireArg<string>(args, 'taskId'), {
        title: requireArg<string>(args, 'title'),
        instructions: requireArg<string>(args, 'instructions'),
        agentId: optArg<string | null>(args, 'agentId'),
      });
    case 'update':
      return aaService.updateAgentAssignment(requireArg<string>(args, 'id'), {
        title: optArg<string>(args, 'title'),
        instructions: optArg<string>(args, 'instructions'),
        agentId: optArg<string | null>(args, 'agentId'),
        sortOrder: optArg<number>(args, 'sortOrder'),
      });
    case 'complete':
      return aaService.completeAgentAssignment(requireArg<string>(args, 'id'));
    case 'delete':
      await aaService.deleteAgentAssignment(requireArg<string>(args, 'id'));
      return { deleted: true };
    default:
      throw new AppError(400, `Unknown agent_assignments action: ${action}`);
  }
}

async function dispatchSchedule(action: string, args: Args): Promise<unknown> {
  switch (action) {
    case 'today':
      return scheduleService.getTodaySlots();
    case 'week':
      return scheduleService.getWeekSlots(optArg<string>(args, 'weekStart') ?? today());
    case 'generate':
      return scheduleService.generateWeekPlan(optArg<string>(args, 'weekStart'));
    case 'assign':
      return scheduleService.assignAgentAssignment(
        requireArg<string>(args, 'agentAssignmentId'),
        requireArg<string>(args, 'slotId'),
      );
    case 'unassign':
      return scheduleService.unassignAgentAssignment(requireArg<string>(args, 'slotId'));
    case 'done':
      return scheduleService.doneSlot(requireArg<string>(args, 'slotId'), {
        note: optArg<string>(args, 'note'),
      });
    case 'skip':
      return scheduleService.skipSlot(requireArg<string>(args, 'slotId'), {
        reason: optArg<string>(args, 'reason'),
      });
    case 'update':
      return scheduleService.updateSlot(requireArg<string>(args, 'slotId'), {
        status: optArg<string>(args, 'status') as any,
        agentAssignmentId: optArg<string | null>(args, 'agentAssignmentId'),
        note: optArg<string | null>(args, 'note'),
      });
    case 'add_output':
      return scheduleService.addSlotOutput(requireArg<string>(args, 'slotId'), {
        label: requireArg<string>(args, 'label'),
        url: optArg<string>(args, 'url'),
        kind: requireArg<'created' | 'updated' | 'deleted'>(args, 'kind'),
      });
    case 'delete_output':
      await scheduleService.deleteSlotOutput(
        requireArg<string>(args, 'slotId'),
        requireArg<string>(args, 'outputId'),
      );
      return { deleted: true };
    default:
      throw new AppError(400, `Unknown schedule action: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

async function dispatch(name: string, args: Args): Promise<unknown> {
  switch (name) {
    case 'board':
      return boardService.getBoard();
    case 'health': {
      const allGoals = await goalsService.listGoals({});
      return { status: 'ok', goals: allGoals.length };
    }
    case 'goals':
      return dispatchGoals(requireArg<string>(args, 'action'), args);
    case 'initiatives':
      return dispatchInitiatives(requireArg<string>(args, 'action'), args);
    case 'tasks':
      return dispatchTasks(requireArg<string>(args, 'action'), args);
    case 'requirements':
      return dispatchRequirements(requireArg<string>(args, 'action'), args);
    case 'agent_assignments':
      return dispatchAgentAssignments(requireArg<string>(args, 'action'), args);
    case 'schedule':
      return dispatchSchedule(requireArg<string>(args, 'action'), args);
    default:
      throw new AppError(404, `Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'mission-control', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS as unknown as Tool[],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      const result = await dispatch(name, args as Args);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      if (e instanceof AppError) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: e.message,
                statusCode: e.statusCode,
                details: e.details,
              }),
            },
          ],
          isError: true,
        };
      }
      throw e;
    }
  });

  return server;
}
