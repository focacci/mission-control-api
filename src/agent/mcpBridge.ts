import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { AppError, today } from '../types/index.types.js';
import * as goalsService from '../services/goals.service.js';
import * as initiativesService from '../services/initiatives.service.js';
import * as tasksService from '../services/tasks.service.js';
import * as requirementsService from '../services/requirements.service.js';
import * as aaService from '../services/agentAssignments.service.js';
import * as scheduleService from '../services/schedule.service.js';
import * as boardService from '../services/board.service.js';
import * as profileService from '../services/profile.service.js';
import * as contextGroupsService from '../services/contextGroups.service.js';
import * as briefsService from '../services/briefs.service.js';
import * as agentsService from '../services/agents.service.js';
import * as conversationsService from '../services/conversations.service.js';
import * as invocationsService from '../services/invocations.service.js';
import { runBufferedChatTurn } from './chatOrchestrator.js';

// ---------------------------------------------------------------------------
// Coarse-grained tool definitions (one tool per domain aggregate).
// Local LLMs have limited context for tool schemas, so each tool dispatches
// to multiple underlying service actions via an "action" discriminator.
//
// This module is the single source of truth for the MC tool catalog.
// Consumers:
//   - `src/mcp/server.ts` — mounts these tools on an MCP stdio server.
//   - `src/agent/runner.ts` (Phase 2) — will call `dispatch` directly for
//     in-process tool execution when wired.
// ---------------------------------------------------------------------------

export const TOOLS = [
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
    name: 'profile',
    description:
      "Long-running picture of the user (sections + entries). Default action `get` returns the full profile — prefer this so you can reason over every section in one call. Actions: get, get_section, update_section, add_entry, update_entry, delete_entry.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'get', 'get_section', 'update_section',
            'add_entry', 'update_entry', 'delete_entry',
          ],
          description: 'Operation to perform. Defaults to `get` if omitted.',
        },
        sectionId: {
          type: 'string',
          description: "Section id (e.g. 'overview', 'traits'). Required for section/add_entry actions.",
        },
        entryId: { type: 'string', description: 'Entry id (for update_entry/delete_entry).' },
        summary: { type: 'string', description: 'Section summary (null to clear on update_section).' },
        label: { type: 'string', description: 'Entry label (add_entry/update_entry).' },
        detail: { type: 'string', description: 'Entry detail text (null to clear).' },
        confidence: {
          type: 'string',
          enum: ['observed', 'inferred', 'stated'],
          description: 'How the agent knows this entry.',
        },
        source: { type: 'string', description: 'Free-text source (chat, manual, invocation id).' },
        sortOrder: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'context_groups',
    description:
      "User's saved chat-context bundles. Pinned contexts are a flat list; groups bundle multiple context refs. Actions: list_pinned, pin, unpin, list_groups, get_group, create_group, update_group, delete_group, add_member, remove_member.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'list_pinned', 'pin', 'unpin',
            'list_groups', 'get_group', 'create_group', 'update_group', 'delete_group',
            'add_member', 'remove_member',
          ],
          description: 'Operation to perform.',
        },
        id: { type: 'string', description: 'Pinned context id (unpin) or group id (get/update/delete/add_member).' },
        groupId: { type: 'string', description: 'Group id for remove_member.' },
        memberId: { type: 'string', description: 'Member id for remove_member.' },
        contextType: { type: 'string', description: 'Maps to ChatContextKind.contextType.' },
        contextId: { type: 'string', description: 'Entity id (null for non-entity kinds).' },
        label: { type: 'string', description: 'Display snapshot label.' },
        icon: { type: 'string', description: 'SF Symbol snapshot.' },
        typeName: { type: 'string', description: 'Human-readable kind label.' },
        payload: { type: 'string', description: 'JSON blob of extras (date, mode, section, etc.).' },
        name: { type: 'string', description: 'Group name (create_group/update_group).' },
        summary: { type: 'string', description: 'Group summary (null to clear on update_group).' },
        members: {
          type: 'array',
          description: 'Initial members for create_group.',
          items: { type: 'object' },
        },
        sortOrder: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'briefings',
    description:
      'Morning/afternoon/evening briefings per day. `generate` kicks the agent (Track C) — returns 501 until runner ships; other actions (including manual PATCH via update) are usable now. Actions: list, get, get_by_date, generate, update, delete.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'get_by_date', 'generate', 'update', 'delete'],
          description: 'Operation to perform.',
        },
        id: { type: 'string', description: 'Brief id (get/update/delete).' },
        date: { type: 'string', description: 'YYYY-MM-DD (get_by_date/generate).' },
        from: { type: 'string', description: 'List range start YYYY-MM-DD.' },
        to: { type: 'string', description: 'List range end YYYY-MM-DD.' },
        kind: {
          type: 'string',
          enum: ['morning', 'afternoon', 'evening'],
          description: 'Brief slot (generate).',
        },
        title: { type: 'string', description: 'Brief title (null to clear on update).' },
        body: { type: 'string', description: 'Brief body markdown (null to clear on update).' },
        references: {
          type: 'string',
          description: 'JSON blob of referenced entity ids (null to clear on update).',
        },
        status: {
          type: 'string',
          enum: ['pending', 'generating', 'ready', 'error'],
          description: 'Status (update only).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'agents',
    description:
      "Manage openclaw-backed agents (the entities that run chat / brief / slot invocations). DB is the source of truth; create/delete also write through to the openclaw CLI. Actions: list, get, create, update, delete, repair. `update` only touches systemPrompt (pass null to clear). `repair` re-creates any DB-tracked agent that has gone missing from the CLI.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'delete', 'repair'],
          description: 'Operation to perform.',
        },
        id: { type: 'string', description: 'Agent id (required for get/update/delete).' },
        name: { type: 'string', description: 'Agent display name (create).' },
        model: { type: 'string', description: 'Model id (create).' },
        systemPrompt: {
          type: 'string',
          description: 'System prompt / SOUL.md body. Pass null in update to clear.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'chat',
    description:
      "Chat sessions and messages. `send_message` is the only write path and proxies through the agent (creates an invocation, appends user + assistant messages). Everything else is reads and deletes. Actions: list_sessions, get_session, create_session, list_messages, delete_session, send_message.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'list_sessions', 'get_session', 'create_session',
            'list_messages', 'delete_session', 'send_message',
          ],
          description: 'Operation to perform.',
        },
        id: { type: 'string', description: 'Session id (get_session/list_messages/delete_session).' },
        agentId: {
          type: 'string',
          description: 'Agent id filter (list_sessions) or target (create_session/send_message).',
        },
        contextType: {
          type: 'string',
          description: 'Context type filter (list_sessions) or snapshot (create_session).',
        },
        contextId: { type: 'string', description: 'Context id filter or snapshot.' },
        title: { type: 'string', description: 'Session title (create_session).' },
        limit: { type: 'number', description: 'Page size (list_sessions/list_messages).' },
        before: { type: 'string', description: 'Message id pagination anchor (list_messages).' },
        message: { type: 'string', description: 'Message body (send_message).' },
        sessionId: { type: 'string', description: 'Session id (send_message).' },
        context: {
          type: 'object',
          description: 'Chat context snapshot for send_message.',
          properties: {
            type: { type: 'string' },
            id: { type: 'string' },
            name: { type: 'string' },
            emoji: { type: 'string' },
            section: { type: 'string' },
            date: { type: 'string' },
          },
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'invocations',
    description:
      "Agent invocations (one per chat turn / brief run / slot). Read-only today; `cancel` returns 501 until the in-process runner (Track C) ships. Actions: list, get, cancel.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'cancel'],
          description: 'Operation to perform.',
        },
        id: { type: 'string', description: 'Invocation id (get/cancel).' },
        trigger: {
          type: 'string',
          enum: ['slot_start', 'brief', 'user_chat', 'manual'],
          description: 'Trigger filter (list).',
        },
        status: {
          type: 'string',
          enum: ['running', 'complete', 'error', 'timeout', 'cancelled'],
          description: 'Status filter (list).',
        },
        limit: { type: 'number', description: 'Page size (list).' },
        since: { type: 'string', description: 'ISO timestamp — only invocations started at/after (list).' },
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

export const TOOLS_AS_MCP = TOOLS as unknown as Tool[];

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

async function dispatchProfile(action: string | undefined, args: Args): Promise<unknown> {
  switch (action ?? 'get') {
    case 'get':
      return profileService.getProfile();
    case 'get_section':
      return profileService.getSection(requireArg<string>(args, 'sectionId'));
    case 'update_section':
      return profileService.updateSection(requireArg<string>(args, 'sectionId'), {
        summary: optArg<string | null>(args, 'summary'),
        sortOrder: optArg<number>(args, 'sortOrder'),
      });
    case 'add_entry':
      return profileService.addEntry(requireArg<string>(args, 'sectionId'), {
        label: requireArg<string>(args, 'label'),
        detail: optArg<string | null>(args, 'detail'),
        confidence: optArg<'observed' | 'inferred' | 'stated'>(args, 'confidence'),
        source: optArg<string | null>(args, 'source'),
        sortOrder: optArg<number>(args, 'sortOrder'),
      });
    case 'update_entry':
      return profileService.updateEntry(requireArg<string>(args, 'entryId'), {
        label: optArg<string>(args, 'label'),
        detail: optArg<string | null>(args, 'detail'),
        confidence: optArg<'observed' | 'inferred' | 'stated'>(args, 'confidence'),
        source: optArg<string | null>(args, 'source'),
        sortOrder: optArg<number>(args, 'sortOrder'),
      });
    case 'delete_entry':
      await profileService.deleteEntry(requireArg<string>(args, 'entryId'));
      return { deleted: true };
    default:
      throw new AppError(400, `Unknown profile action: ${action}`);
  }
}

async function dispatchContextGroups(action: string, args: Args): Promise<unknown> {
  switch (action) {
    case 'list_pinned':
      return contextGroupsService.listPinnedContexts();
    case 'pin':
      return contextGroupsService.createPinnedContext({
        contextType: requireArg<string>(args, 'contextType'),
        contextId: optArg<string | null>(args, 'contextId'),
        label: requireArg<string>(args, 'label'),
        icon: requireArg<string>(args, 'icon'),
        typeName: requireArg<string>(args, 'typeName'),
        payload: optArg<string | null>(args, 'payload'),
        sortOrder: optArg<number>(args, 'sortOrder'),
      });
    case 'unpin':
      await contextGroupsService.deletePinnedContext(requireArg<string>(args, 'id'));
      return { deleted: true };
    case 'list_groups':
      return contextGroupsService.listContextGroups();
    case 'get_group':
      return contextGroupsService.getContextGroup(requireArg<string>(args, 'id'));
    case 'create_group':
      return contextGroupsService.createContextGroup({
        name: requireArg<string>(args, 'name'),
        icon: optArg<string>(args, 'icon'),
        summary: optArg<string | null>(args, 'summary'),
        members: optArg<any[]>(args, 'members'),
      });
    case 'update_group':
      return contextGroupsService.updateContextGroup(requireArg<string>(args, 'id'), {
        name: optArg<string>(args, 'name'),
        icon: optArg<string>(args, 'icon'),
        summary: optArg<string | null>(args, 'summary'),
        sortOrder: optArg<number>(args, 'sortOrder'),
      });
    case 'delete_group':
      await contextGroupsService.deleteContextGroup(requireArg<string>(args, 'id'));
      return { deleted: true };
    case 'add_member':
      return contextGroupsService.addContextGroupMember(requireArg<string>(args, 'id'), {
        contextType: requireArg<string>(args, 'contextType'),
        contextId: optArg<string | null>(args, 'contextId'),
        label: requireArg<string>(args, 'label'),
        icon: requireArg<string>(args, 'icon'),
        typeName: requireArg<string>(args, 'typeName'),
        payload: optArg<string | null>(args, 'payload'),
        sortOrder: optArg<number>(args, 'sortOrder'),
      });
    case 'remove_member':
      await contextGroupsService.removeContextGroupMember(
        requireArg<string>(args, 'groupId'),
        requireArg<string>(args, 'memberId'),
      );
      return { deleted: true };
    default:
      throw new AppError(400, `Unknown context_groups action: ${action}`);
  }
}

async function dispatchBriefings(action: string, args: Args): Promise<unknown> {
  switch (action) {
    case 'list':
      return briefsService.listBriefs({
        from: requireArg<string>(args, 'from'),
        to: requireArg<string>(args, 'to'),
      });
    case 'get':
      return briefsService.getBrief(requireArg<string>(args, 'id'));
    case 'get_by_date':
      return briefsService.getBriefsByDate(requireArg<string>(args, 'date'));
    case 'generate':
      return briefsService.generateBrief({
        date: requireArg<string>(args, 'date'),
        kind: requireArg<'morning' | 'afternoon' | 'evening'>(args, 'kind'),
      });
    case 'update':
      return briefsService.updateBrief(requireArg<string>(args, 'id'), {
        title: optArg<string | null>(args, 'title'),
        body: optArg<string | null>(args, 'body'),
        references: optArg<string | null>(args, 'references'),
        status: optArg<'pending' | 'generating' | 'ready' | 'error'>(args, 'status'),
      });
    case 'delete':
      await briefsService.deleteBrief(requireArg<string>(args, 'id'));
      return { deleted: true };
    default:
      throw new AppError(400, `Unknown briefings action: ${action}`);
  }
}

async function dispatchAgents(action: string, args: Args): Promise<unknown> {
  switch (action) {
    case 'list':
      return agentsService.listAgents();
    case 'get':
      return agentsService.getAgent(requireArg<string>(args, 'id'));
    case 'create':
      return agentsService.createAgent({
        name: requireArg<string>(args, 'name'),
        model: requireArg<string>(args, 'model'),
        systemPrompt: optArg<string>(args, 'systemPrompt'),
      });
    case 'update':
      return agentsService.updateAgent(requireArg<string>(args, 'id'), {
        systemPrompt: optArg<string | null>(args, 'systemPrompt'),
      });
    case 'delete':
      await agentsService.deleteAgent(requireArg<string>(args, 'id'));
      return { deleted: true };
    case 'repair':
      return agentsService.repairAgents();
    default:
      throw new AppError(400, `Unknown agents action: ${action}`);
  }
}

async function dispatchChat(action: string, args: Args): Promise<unknown> {
  switch (action) {
    case 'list_sessions':
      return conversationsService.listSessions({
        agentId: optArg<string>(args, 'agentId'),
        contextType: optArg<string>(args, 'contextType'),
        contextId: optArg<string>(args, 'contextId'),
        limit: optArg<number>(args, 'limit'),
      });
    case 'get_session': {
      const id = requireArg<string>(args, 'id');
      const session = await conversationsService.getSession(id);
      const messageCount = await conversationsService.getMessageCount(id);
      return { ...session, messageCount };
    }
    case 'create_session':
      return conversationsService.createSession({
        agentId: requireArg<string>(args, 'agentId'),
        contextType: optArg<string | null>(args, 'contextType'),
        contextId: optArg<string | null>(args, 'contextId'),
        title: optArg<string | null>(args, 'title'),
      });
    case 'list_messages':
      return conversationsService.listMessages(requireArg<string>(args, 'id'), {
        limit: optArg<number>(args, 'limit'),
        before: optArg<string>(args, 'before'),
      });
    case 'delete_session':
      await conversationsService.deleteSession(requireArg<string>(args, 'id'));
      return { deleted: true };
    case 'send_message': {
      const result = await runBufferedChatTurn({
        message: requireArg<string>(args, 'message'),
        agentId: optArg<string>(args, 'agentId'),
        context: optArg<any>(args, 'context'),
        sessionId: optArg<string>(args, 'sessionId'),
      });
      return {
        reply: result.reply,
        sessionId: result.sessionId,
        agentId: result.agentId,
        invocationId: result.invocationId,
      };
    }
    default:
      throw new AppError(400, `Unknown chat action: ${action}`);
  }
}

async function dispatchInvocations(action: string, args: Args): Promise<unknown> {
  switch (action) {
    case 'list':
      return invocationsService.listInvocations({
        trigger: optArg<any>(args, 'trigger'),
        status: optArg<any>(args, 'status'),
        limit: optArg<number>(args, 'limit'),
        since: optArg<string>(args, 'since'),
      });
    case 'get':
      return invocationsService.getInvocation(requireArg<string>(args, 'id'));
    case 'cancel':
      throw new AppError(
        501,
        'invocations.cancel requires the in-process agent runner (Track C) — not yet implemented.',
      );
    default:
      throw new AppError(400, `Unknown invocations action: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

export async function dispatch(name: string, args: Args): Promise<unknown> {
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
    case 'profile':
      return dispatchProfile(optArg<string>(args, 'action'), args);
    case 'context_groups':
      return dispatchContextGroups(requireArg<string>(args, 'action'), args);
    case 'briefings':
      return dispatchBriefings(requireArg<string>(args, 'action'), args);
    case 'agents':
      return dispatchAgents(requireArg<string>(args, 'action'), args);
    case 'chat':
      return dispatchChat(requireArg<string>(args, 'action'), args);
    case 'invocations':
      return dispatchInvocations(requireArg<string>(args, 'action'), args);
    default:
      throw new AppError(404, `Unknown tool: ${name}`);
  }
}
