import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  AppError,
  CARD_KINDS,
  type CardKind,
  type MessagePart,
  today,
} from '../types/index.types.js';
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
import * as pendingPartsService from '../services/pendingParts.service.js';
import * as attachmentsService from '../services/attachments.service.js';
import { runBufferedChatTurn } from './chatOrchestrator.js';
import type { ChatSession } from '../services/conversations.service.js';

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
    name: 'current_context',
    description:
      'Snapshot of the chat session\'s anchor context, with the linked entity hydrated. Prefer this over chaining chat.get_session → tasks.get / goals.get / etc. Returns { sessionId, agentId, contextType, contextId, title, resolvedEntity }. `resolvedEntity` is the goal / initiative / task / agent_assignment / brief row when contextType is one of those, otherwise null.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Chat session id (required).' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'pin_to_context',
    description:
      "Pin an entity reference onto the active chat session. v1 semantics: only writes if the session has no context yet — if already anchored, returns { pinned: false, reason: 'already_anchored' } without overwriting. Use this when a chat that started unanchored has clearly drifted onto a specific task/goal/initiative.",
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Chat session id (required).' },
        contextType: {
          type: 'string',
          description: "Target context type, e.g. 'goal' | 'initiative' | 'task' | 'agent_assignment' | 'brief'.",
        },
        contextId: { type: 'string', description: 'Target entity id (null allowed for non-entity kinds).' },
      },
      required: ['sessionId', 'contextType'],
    },
  },
  {
    name: 'goals',
    description:
      'Manage goals (top-level objectives with focus levels). Actions: list, get, create, update, delete. For get/update/delete, `id` defaults to the active session\'s goal context when omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'delete'],
          description: 'Operation to perform.',
        },
        sessionId: {
          type: 'string',
          description: 'Active chat session — used to default `id` from session context when omitted.',
        },
        id: { type: 'string', description: 'Goal ID. Defaults to session context id when sessionId is set and contextType is `goal`.' },
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
      'Manage initiatives (actionable projects under goals). Actions: list, get, create, update, complete, delete. For non-list/create actions, `id` defaults to the active session\'s initiative context when omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'complete', 'delete'],
          description: 'Operation to perform.',
        },
        sessionId: {
          type: 'string',
          description: 'Active chat session — used to default `id` from session context when omitted.',
        },
        id: { type: 'string', description: 'Initiative ID. Defaults to session context id when sessionId is set and contextType is `initiative`.' },
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
      'Manage tasks (human-owned work). Actions: list, get, create, update, start, complete, block, cancel, delete. Requirements and agent assignments live on their own tools. For non-list/create actions, `id` defaults to the active session\'s task context when omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'list', 'get', 'create', 'update', 'complete', 'reopen', 'delete',
          ],
          description: 'Operation to perform.',
        },
        sessionId: {
          type: 'string',
          description: 'Active chat session — used to default `id` from session context when omitted.',
        },
        id: { type: 'string', description: 'Task ID. Defaults to session context id when sessionId is set and contextType is `task`.' },
        initiativeId: { type: 'string', description: 'Parent initiative ID. For list: filter. For create: link.' },
        name: { type: 'string', description: 'Task name (create/update).' },
        objective: { type: 'string', description: 'Definition of done (create/update).' },
        status: {
          type: 'string',
          enum: ['pending', 'done'],
          description: 'Status filter (list) or value (update).',
        },
        sortOrder: { type: 'number', description: 'Sort position (update only).' },
        summary: { type: 'string', description: 'Completion summary (complete action).' },
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
      'Manage task requirements and their tests. Actions: add, update, check, uncheck, delete, add_test, update_test, pass_test, unpass_test, delete_test. For `add`, `taskId` defaults to the active session\'s task context when omitted.',
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
        sessionId: {
          type: 'string',
          description: 'Active chat session — used to default `taskId` from session context when omitted.',
        },
        taskId: { type: 'string', description: 'Parent task ID. Defaults to session context id when sessionId is set and contextType is `task`.' },
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
      'Manage agent assignments (discrete agent work attached to a goal, initiative, or task). Actions: list, get, create, update, start, complete, block, reopen, unassign, delete. For list/create, supply exactly one parent: goalId, initiativeId, or taskId (parent ids also default from session context when sessionId is set). `unassign` clears any scheduled slot links and resets status to pending. For non-list/create actions, `id` defaults to the active session\'s agent_assignment context when omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'start', 'complete', 'block', 'reopen', 'unassign', 'delete'],
          description: 'Operation to perform.',
        },
        sessionId: {
          type: 'string',
          description: 'Active chat session — used to default `id` (or list/create parent) from session context when omitted.',
        },
        id: { type: 'string', description: 'Agent assignment ID. Defaults to session context id when sessionId is set and contextType is `agent_assignment`.' },
        goalId: { type: 'string', description: 'Parent goal ID (list/create).' },
        initiativeId: { type: 'string', description: 'Parent initiative ID (list/create).' },
        taskId: { type: 'string', description: 'Parent task ID (list/create).' },
        title: { type: 'string', description: 'Short label (create/update).' },
        description: { type: 'string', description: 'Free-form description of the assignment (create/update; optional).' },
        agentId: { type: 'string', description: 'Agent to bind (create/update; null to clear).' },
        sortOrder: { type: 'number', description: 'Sort position (update only).' },
      },
      required: ['action'],
    },
  },
  {
    name: 'schedule',
    description:
      'Manage the weekly schedule. Actions: today, week, generate, assign, unassign, done, skip, update, add_output, delete_output, suggest. `suggest` returns a ranked list of candidate slots for an agent assignment (read-only); pair with `assign` once the user picks one.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'today', 'week', 'generate', 'assign', 'unassign',
            'done', 'skip', 'update', 'add_output', 'delete_output',
            'suggest',
          ],
          description: 'Operation to perform.',
        },
        slotId: { type: 'string', description: 'Slot ID (required for most mutating actions).' },
        agentAssignmentId: {
          type: 'string',
          description: 'Agent assignment ID (assign/suggest action, or null to clear in update).',
        },
        weekStart: {
          type: 'string',
          description: 'Date in target week, YYYY-MM-DD (week/generate/suggest actions; defaults to current week).',
        },
        limit: {
          type: 'number',
          description: 'Max candidates to return (suggest action; defaults to 5).',
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
  // -------------------------------------------------------------------------
  // Bucket 2b — interface tools (MCP_TOOLKIT_PLAN). Each appends a structured
  // part to the in-flight assistant message via the pending_message_parts
  // queue, which the runner drains when it flushes the buffered text.
  // -------------------------------------------------------------------------
  {
    name: 'render_card',
    description:
      "Append a rich entity card to the current assistant message. The iOS client renders the matching screen-row component for `cardType` keyed on `entityId`. Use when the natural reply is 'here's the thing' rather than a paragraph about it. Card kinds: 'task' | 'goal' | 'initiative' | 'agent_assignment' | 'slot' | 'schedule_day'.",
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Active chat session id (required).' },
        cardType: {
          type: 'string',
          enum: [...CARD_KINDS],
          description: 'Which card the iOS client should render.',
        },
        entityId: { type: 'string', description: 'Id of the goal/initiative/task/etc to hydrate.' },
      },
      required: ['sessionId', 'cardType', 'entityId'],
    },
  },
  {
    name: 'suggest_replies',
    description:
      "Append a row of tap-to-send quick reply chips above the iOS composer. Use sparingly — only when there's a small set of clearly-better-than-typing follow-ups (e.g. 'Yes / Not now / Tell me more'). Each suggestion needs a stable `id` and a short `label`.",
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Active chat session id (required).' },
        suggestions: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
            },
            required: ['id', 'label'],
          },
          description: '1–6 tap-to-send suggestions.',
        },
      },
      required: ['sessionId', 'suggestions'],
    },
  },
  {
    name: 'navigate',
    description:
      'Append a tappable deep-link to the current assistant message. The iOS client renders it as a row beneath the assistant text and routes to `route` on tap. Use when the helpful next step is a screen, not more text.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Active chat session id (required).' },
        route: {
          type: 'string',
          description: "Deep-link path the iOS router understands (e.g. '/tasks/<id>', '/schedule/today').",
        },
        label: { type: 'string', description: 'Tap label, e.g. "Open task" or "View today".' },
      },
      required: ['sessionId', 'route', 'label'],
    },
  },
  {
    name: 'attach',
    description:
      "Append a file attachment to the current assistant message. Provide either `sourceUrl` (already-served URL the iOS client can fetch) or `data` (base64 payload — gets written to WORKSPACE_PATH/attachments/<sessionId>/ and served as a workspace:// URL). `name` and `mimeType` are required for both.",
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Active chat session id (required).' },
        name: { type: 'string', description: 'Display filename (e.g. "screenshot.png").' },
        mimeType: { type: 'string', description: 'MIME type (e.g. "image/png", "application/pdf").' },
        sourceUrl: {
          type: 'string',
          description: 'Already-served URL — used as-is when supplied (no upload).',
        },
        data: {
          type: 'string',
          description: 'Base64-encoded file payload — written to disk under the session attachments dir.',
        },
      },
      required: ['sessionId', 'name', 'mimeType'],
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
// Session-context helpers (Bucket 1 of MCP_TOOLKIT_PLAN)
// ---------------------------------------------------------------------------

async function loadSessionForArgs(args: Args): Promise<ChatSession | null> {
  const sessionId = optArg<string>(args, 'sessionId');
  if (!sessionId) return null;
  try {
    return await conversationsService.getSession(sessionId);
  } catch {
    return null;
  }
}

/**
 * Resolve an entity id from explicit args first, falling back to the active
 * chat session's context when its `contextType` matches `expectedContextType`.
 * Throws a 400 if neither path yields an id, mirroring `requireArg`.
 */
async function resolveEntityId(
  args: Args,
  argKey: string,
  expectedContextType: string,
): Promise<string> {
  const explicit = optArg<string>(args, argKey);
  if (explicit) return explicit;
  const session = await loadSessionForArgs(args);
  if (session && session.contextType === expectedContextType && session.contextId) {
    return session.contextId;
  }
  throw new AppError(
    400,
    `Missing required field: ${argKey} (no ${expectedContextType} in session context).`,
  );
}

async function resolveContextEntity(
  contextType: string | null,
  contextId: string | null,
): Promise<unknown | null> {
  if (!contextType || !contextId) return null;
  try {
    switch (contextType) {
      case 'goal':             return await goalsService.getGoal(contextId);
      case 'initiative':       return await initiativesService.getInitiative(contextId);
      case 'task':             return await tasksService.getTask(contextId);
      case 'agent_assignment': return await aaService.getAgentAssignment(contextId);
      case 'brief':            return await briefsService.getBrief(contextId);
      default:                 return null;
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Domain dispatchers
// ---------------------------------------------------------------------------

async function dispatchGoals(action: string, args: Args): Promise<unknown> {
  switch (action) {
    case 'list':
      return goalsService.listGoals({ focus: optArg<string>(args, 'focus') });
    case 'get':
      return goalsService.getGoal(await resolveEntityId(args, 'id', 'goal'));
    case 'create':
      return goalsService.createGoal({
        emoji: requireArg<string>(args, 'emoji'),
        name: requireArg<string>(args, 'name'),
        focus: (optArg<string>(args, 'focus') as 'sprint' | 'steady' | 'simmer' | 'dormant' | undefined) ?? 'steady',
        timeline: optArg<string>(args, 'timeline'),
        story: optArg<string>(args, 'story'),
      });
    case 'update':
      return goalsService.updateGoal(await resolveEntityId(args, 'id', 'goal'), {
        emoji: optArg<string>(args, 'emoji'),
        name: optArg<string>(args, 'name'),
        focus: optArg<string>(args, 'focus') as 'sprint' | 'steady' | 'simmer' | 'dormant' | undefined,
        timeline: optArg<string | null>(args, 'timeline'),
        story: optArg<string | null>(args, 'story'),
        sortOrder: optArg<number>(args, 'sortOrder'),
      });
    case 'delete':
      await goalsService.deleteGoal(await resolveEntityId(args, 'id', 'goal'));
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
      return initiativesService.getInitiative(await resolveEntityId(args, 'id', 'initiative'));
    case 'create':
      return initiativesService.createInitiative({
        emoji: requireArg<string>(args, 'emoji'),
        name: requireArg<string>(args, 'name'),
        goalId: optArg<string>(args, 'goalId'),
        mission: optArg<string>(args, 'mission'),
        status: (optArg<string>(args, 'status') as 'active' | 'backlog' | 'paused' | 'completed' | undefined) ?? 'active',
      });
    case 'update':
      return initiativesService.updateInitiative(await resolveEntityId(args, 'id', 'initiative'), {
        emoji: optArg<string>(args, 'emoji'),
        name: optArg<string>(args, 'name'),
        status: optArg<string>(args, 'status') as 'active' | 'backlog' | 'paused' | 'completed' | undefined,
        mission: optArg<string | null>(args, 'mission'),
        goalId: optArg<string | null>(args, 'goalId'),
        sortOrder: optArg<number>(args, 'sortOrder'),
      });
    case 'complete':
      return initiativesService.completeInitiative(await resolveEntityId(args, 'id', 'initiative'));
    case 'delete':
      await initiativesService.deleteInitiative(await resolveEntityId(args, 'id', 'initiative'));
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
      return tasksService.getTask(await resolveEntityId(args, 'id', 'task'));
    case 'create':
      return tasksService.createTask({
        name: requireArg<string>(args, 'name'),
        objective: requireArg<string>(args, 'objective'),
        initiativeId: optArg<string>(args, 'initiativeId'),
        requirements: optArg<string[]>(args, 'requirements') ?? [],
      });
    case 'update':
      return tasksService.updateTask(await resolveEntityId(args, 'id', 'task'), {
        name: optArg<string>(args, 'name'),
        objective: optArg<string>(args, 'objective'),
        status: optArg<string>(args, 'status') as any,
        sortOrder: optArg<number>(args, 'sortOrder'),
      });
    case 'complete':
      return tasksService.doneTask(await resolveEntityId(args, 'id', 'task'), {
        summary: requireArg<string>(args, 'summary'),
      });
    case 'reopen':
      return tasksService.reopenTask(await resolveEntityId(args, 'id', 'task'));
    case 'delete':
      await tasksService.deleteTask(await resolveEntityId(args, 'id', 'task'));
      return { deleted: true };
    default:
      throw new AppError(400, `Unknown tasks action: ${action}`);
  }
}

async function dispatchRequirements(action: string, args: Args): Promise<unknown> {
  switch (action) {
    case 'add':
      return requirementsService.addRequirement(
        await resolveEntityId(args, 'taskId', 'task'),
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

async function resolveAAParent(args: Args): Promise<{ kind: 'goal' | 'initiative' | 'task'; id: string }> {
  const goalId = optArg<string>(args, 'goalId');
  const initiativeId = optArg<string>(args, 'initiativeId');
  const taskId = optArg<string>(args, 'taskId');
  const provided = [goalId, initiativeId, taskId].filter(Boolean);
  if (provided.length > 1) {
    throw new AppError(
      400,
      'Provide exactly one parent: goalId, initiativeId, or taskId.',
    );
  }
  if (goalId) return { kind: 'goal', id: goalId };
  if (initiativeId) return { kind: 'initiative', id: initiativeId };
  if (taskId) return { kind: 'task', id: taskId };
  // Fall back to chat-session anchor.
  const session = await loadSessionForArgs(args);
  if (session && session.contextId) {
    if (session.contextType === 'goal')        return { kind: 'goal', id: session.contextId };
    if (session.contextType === 'initiative')  return { kind: 'initiative', id: session.contextId };
    if (session.contextType === 'task')        return { kind: 'task', id: session.contextId };
  }
  throw new AppError(
    400,
    'Provide exactly one parent: goalId, initiativeId, or taskId (or set sessionId to one anchored on a goal/initiative/task).',
  );
}

async function dispatchAgentAssignments(action: string, args: Args): Promise<unknown> {
  switch (action) {
    case 'list': {
      const parent = await resolveAAParent(args);
      return aaService.listAgentAssignmentsForParent(parent.kind, parent.id);
    }
    case 'get':
      return aaService.getAgentAssignment(await resolveEntityId(args, 'id', 'agent_assignment'));
    case 'create': {
      const parent = await resolveAAParent(args);
      return aaService.createAgentAssignmentForParent(parent.kind, parent.id, {
        title: requireArg<string>(args, 'title'),
        description: optArg<string | null>(args, 'description'),
        agentId: optArg<string | null>(args, 'agentId'),
      });
    }
    case 'update':
      return aaService.updateAgentAssignment(await resolveEntityId(args, 'id', 'agent_assignment'), {
        title: optArg<string>(args, 'title'),
        description: optArg<string | null>(args, 'description'),
        agentId: optArg<string | null>(args, 'agentId'),
        sortOrder: optArg<number>(args, 'sortOrder'),
      });
    case 'start':
      return aaService.startAgentAssignment(await resolveEntityId(args, 'id', 'agent_assignment'));
    case 'complete':
      return aaService.completeAgentAssignment(await resolveEntityId(args, 'id', 'agent_assignment'));
    case 'block':
      return aaService.blockAgentAssignment(await resolveEntityId(args, 'id', 'agent_assignment'));
    case 'reopen':
      return aaService.reopenAgentAssignment(await resolveEntityId(args, 'id', 'agent_assignment'));
    case 'unassign':
      return aaService.unassignAgentAssignment(await resolveEntityId(args, 'id', 'agent_assignment'));
    case 'delete':
      await aaService.deleteAgentAssignment(await resolveEntityId(args, 'id', 'agent_assignment'));
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
    case 'suggest':
      return scheduleService.suggestSlotsForAssignment(
        requireArg<string>(args, 'agentAssignmentId'),
        optArg<string>(args, 'weekStart'),
        optArg<number>(args, 'limit'),
      );
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
        status: optArg<'pending' | 'drafting' | 'ready' | 'acknowledged' | 'error'>(
          args,
          'status',
        ),
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
// Bucket 2b interface-tool dispatchers — each enqueues a MessagePart that the
// runner merges into the in-flight assistant message at flush time.
// ---------------------------------------------------------------------------

async function dispatchRenderCard(args: Args): Promise<unknown> {
  const sessionId = requireArg<string>(args, 'sessionId');
  const cardType = requireArg<string>(args, 'cardType') as CardKind;
  const entityId = requireArg<string>(args, 'entityId');
  if (!CARD_KINDS.includes(cardType)) {
    throw new AppError(400, `render_card: unknown cardType "${cardType}".`);
  }
  const part: MessagePart = { kind: 'card', cardType, entityId };
  const { invocationId, partId } = await pendingPartsService.enqueuePart(sessionId, part);
  return { rendered: true, partId, invocationId };
}

async function dispatchSuggestReplies(args: Args): Promise<unknown> {
  const sessionId = requireArg<string>(args, 'sessionId');
  const suggestions = requireArg<Array<{ id: string; label: string }>>(args, 'suggestions');
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    throw new AppError(400, 'suggest_replies: `suggestions` must be a non-empty array.');
  }
  for (const s of suggestions) {
    if (!s || typeof s.id !== 'string' || typeof s.label !== 'string') {
      throw new AppError(400, 'suggest_replies: each suggestion needs `id` and `label` strings.');
    }
  }
  const part: MessagePart = { kind: 'quick_replies', suggestions };
  const { invocationId, partId } = await pendingPartsService.enqueuePart(sessionId, part);
  return { rendered: true, partId, invocationId };
}

async function dispatchNavigate(args: Args): Promise<unknown> {
  const sessionId = requireArg<string>(args, 'sessionId');
  const route = requireArg<string>(args, 'route');
  const label = requireArg<string>(args, 'label');
  const part: MessagePart = { kind: 'navigate', route, label };
  const { invocationId, partId } = await pendingPartsService.enqueuePart(sessionId, part);
  return { rendered: true, partId, invocationId };
}

async function dispatchAttach(args: Args): Promise<unknown> {
  const sessionId = requireArg<string>(args, 'sessionId');
  const name = requireArg<string>(args, 'name');
  const mimeType = requireArg<string>(args, 'mimeType');
  const sourceUrl = optArg<string>(args, 'sourceUrl');
  const data = optArg<string>(args, 'data');
  if (!sourceUrl && !data) {
    throw new AppError(400, 'attach: provide either `sourceUrl` or `data`.');
  }
  if (sourceUrl && data) {
    throw new AppError(400, 'attach: provide only one of `sourceUrl` or `data`.');
  }

  let url: string;
  let size: number | undefined;
  if (sourceUrl) {
    url = sourceUrl;
  } else {
    const saved = attachmentsService.saveAttachment({
      sessionId,
      name,
      mimeType,
      data: data!,
    });
    url = saved.url;
    size = saved.size;
  }

  const part: MessagePart = {
    kind: 'attachment',
    mimeType,
    name,
    url,
    ...(size !== undefined ? { size } : {}),
  };
  const { invocationId, partId } = await pendingPartsService.enqueuePart(sessionId, part);
  return { rendered: true, partId, invocationId, url, size };
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
    case 'current_context': {
      const session = await conversationsService.getSession(requireArg<string>(args, 'sessionId'));
      const resolvedEntity = await resolveContextEntity(session.contextType, session.contextId);
      return {
        sessionId: session.id,
        agentId: session.agentId,
        contextType: session.contextType,
        contextId: session.contextId,
        title: session.title,
        resolvedEntity,
      };
    }
    case 'pin_to_context': {
      return conversationsService.pinSessionContext(
        requireArg<string>(args, 'sessionId'),
        requireArg<string>(args, 'contextType'),
        optArg<string | null>(args, 'contextId') ?? null,
      );
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
    case 'render_card':
      return dispatchRenderCard(args);
    case 'suggest_replies':
      return dispatchSuggestReplies(args);
    case 'navigate':
      return dispatchNavigate(args);
    case 'attach':
      return dispatchAttach(args);
    default:
      throw new AppError(404, `Unknown tool: ${name}`);
  }
}
