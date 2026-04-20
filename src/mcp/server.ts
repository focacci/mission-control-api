import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import { AppError, today } from '../types/index.types.js';
import * as goalsService from '../services/goals.service.js';
import * as initiativesService from '../services/initiatives.service.js';
import * as tasksService from '../services/tasks.service.js';
import * as scheduleService from '../services/schedule.service.js';
import * as boardService from '../services/board.service.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  // --- Health / Board ---
  {
    name: 'health',
    description: 'Basic health check. Returns status and total goal count.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_board',
    description: 'Full board hierarchy: all goals with nested initiatives and tasks, plus stats and current-week summary.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },

  // --- Goals ---
  {
    name: 'list_goals',
    description: 'List all goals, optionally filtered by focus level.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          enum: ['sprint', 'steady', 'simmer', 'dormant'],
          description: 'Filter goals by focus level.',
        },
      },
    },
  },
  {
    name: 'get_goal',
    description: 'Get a single goal by ID, including its nested initiatives.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Goal ID.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_goal',
    description: 'Create a new goal.',
    inputSchema: {
      type: 'object',
      properties: {
        emoji: { type: 'string', description: 'Emoji representing the goal.' },
        name: { type: 'string', description: 'Goal name.' },
        focus: {
          type: 'string',
          enum: ['sprint', 'steady', 'simmer', 'dormant'],
          description: 'Focus level (default: steady).',
        },
        timeline: { type: 'string', description: 'Optional timeline string.' },
        story: { type: 'string', description: 'Optional narrative/context.' },
      },
      required: ['emoji', 'name'],
    },
  },
  {
    name: 'update_goal',
    description: 'Update an existing goal. Only provided fields are changed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Goal ID.' },
        emoji: { type: 'string' },
        name: { type: 'string' },
        focus: { type: 'string', enum: ['sprint', 'steady', 'simmer', 'dormant'] },
        timeline: { type: ['string', 'null'], description: 'Set null to clear.' },
        story: { type: ['string', 'null'], description: 'Set null to clear.' },
        sortOrder: { type: 'number', description: 'Integer sort position.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_goal',
    description: 'Hard-delete a goal and all its initiatives and tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Goal ID.' },
      },
      required: ['id'],
    },
  },

  // --- Initiatives ---
  {
    name: 'list_initiatives',
    description: 'List initiatives, optionally filtered by goalId and/or status.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string', description: 'Filter by parent goal ID.' },
        status: {
          type: 'string',
          enum: ['active', 'backlog', 'paused', 'completed'],
          description: 'Filter by status.',
        },
      },
    },
  },
  {
    name: 'get_initiative',
    description: 'Get a single initiative by ID, including its parent goal and tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Initiative ID.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_initiative',
    description: 'Create a new initiative.',
    inputSchema: {
      type: 'object',
      properties: {
        emoji: { type: 'string', description: 'Emoji for the initiative.' },
        name: { type: 'string', description: 'Initiative name.' },
        goalId: { type: 'string', description: 'Parent goal ID (optional).' },
        mission: { type: 'string', description: 'Mission statement (optional).' },
        status: {
          type: 'string',
          enum: ['active', 'backlog', 'paused', 'completed'],
          description: 'Initial status (default: active).',
        },
      },
      required: ['emoji', 'name'],
    },
  },
  {
    name: 'update_initiative',
    description: 'Update an existing initiative. Only provided fields are changed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Initiative ID.' },
        emoji: { type: 'string' },
        name: { type: 'string' },
        status: { type: 'string', enum: ['active', 'backlog', 'paused', 'completed'] },
        mission: { type: ['string', 'null'], description: 'Set null to clear.' },
        goalId: { type: ['string', 'null'], description: 'Set null to unlink from goal.' },
        sortOrder: { type: 'number', description: 'Integer sort position.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'complete_initiative',
    description: 'Mark an initiative as completed. Cancels all non-terminal tasks under it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Initiative ID.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_initiative',
    description: 'Hard-delete an initiative and all its tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Initiative ID.' },
      },
      required: ['id'],
    },
  },

  // --- Tasks ---
  {
    name: 'list_tasks',
    description: 'List tasks. Optionally filter by initiativeId and/or status (status can be a single value or array).',
    inputSchema: {
      type: 'object',
      properties: {
        initiativeId: { type: 'string', description: 'Filter by initiative ID.' },
        status: {
          oneOf: [
            {
              type: 'string',
              enum: ['pending', 'assigned', 'in-progress', 'done', 'blocked', 'cancelled'],
            },
            {
              type: 'array',
              items: {
                type: 'string',
                enum: ['pending', 'assigned', 'in-progress', 'done', 'blocked', 'cancelled'],
              },
            },
          ],
          description: 'Filter by status; accepts a single value or array.',
        },
      },
    },
  },
  {
    name: 'get_task',
    description: 'Get a single task by ID with full detail: requirements, tests, outputs, initiative, and current slot.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task, optionally with pre-populated requirements and tests.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Task name.' },
        objective: { type: 'string', description: 'Clear objective/definition of done.' },
        initiativeId: { type: 'string', description: 'Parent initiative ID (optional).' },
        emoji: { type: 'string', description: 'Override emoji (derived from initiative if omitted).' },
        requirements: {
          type: 'array',
          items: { type: 'string' },
          description: 'Initial requirement descriptions.',
        },
        tests: {
          type: 'array',
          items: { type: 'string' },
          description: 'Initial test descriptions.',
        },
      },
      required: ['name', 'objective'],
    },
  },
  {
    name: 'update_task',
    description: 'Update task fields. Only provided fields are changed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID.' },
        name: { type: 'string' },
        objective: { type: 'string' },
        status: {
          type: 'string',
          enum: ['pending', 'assigned', 'in-progress', 'done', 'blocked', 'cancelled'],
        },
        sortOrder: { type: 'number' },
      },
      required: ['id'],
    },
  },
  {
    name: 'start_task',
    description: 'Transition a task to in-progress status.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as done. Requires all requirements to already be checked. Optionally attaches outputs.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID.' },
        summary: { type: 'string', description: 'Completion summary.' },
        outputs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              url: { type: 'string' },
            },
            required: ['label'],
          },
          description: 'Optional output artifacts to attach.',
        },
      },
      required: ['id', 'summary'],
    },
  },
  {
    name: 'block_task',
    description: 'Mark a task as blocked with a reason.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID.' },
        reason: { type: 'string', description: 'Reason for blocking.' },
      },
      required: ['id', 'reason'],
    },
  },
  {
    name: 'cancel_task',
    description: 'Cancel a task.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_task',
    description: 'Hard-delete a task and all its requirements, tests, and outputs.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID.' },
      },
      required: ['id'],
    },
  },

  // --- Requirements ---
  {
    name: 'add_requirement',
    description: 'Add a requirement checklist item to a task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID.' },
        description: { type: 'string', description: 'Requirement description.' },
      },
      required: ['taskId', 'description'],
    },
  },
  {
    name: 'update_requirement',
    description: 'Update a requirement\'s description or completed state.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID.' },
        reqId: { type: 'string', description: 'Requirement ID.' },
        description: { type: 'string' },
        completed: { type: 'boolean' },
      },
      required: ['taskId', 'reqId'],
    },
  },
  {
    name: 'check_requirement',
    description: 'Mark a requirement as completed.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID.' },
        reqId: { type: 'string', description: 'Requirement ID.' },
      },
      required: ['taskId', 'reqId'],
    },
  },
  {
    name: 'uncheck_requirement',
    description: 'Mark a requirement as not completed.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID.' },
        reqId: { type: 'string', description: 'Requirement ID.' },
      },
      required: ['taskId', 'reqId'],
    },
  },
  {
    name: 'delete_requirement',
    description: 'Delete a requirement from a task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID.' },
        reqId: { type: 'string', description: 'Requirement ID.' },
      },
      required: ['taskId', 'reqId'],
    },
  },

  // --- Tests ---
  {
    name: 'add_test',
    description: 'Add a test/verification step to a task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID.' },
        description: { type: 'string', description: 'Test description.' },
      },
      required: ['taskId', 'description'],
    },
  },
  {
    name: 'update_test',
    description: 'Update a test\'s description or passed state.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID.' },
        testId: { type: 'string', description: 'Test ID.' },
        description: { type: 'string' },
        passed: { type: 'boolean' },
      },
      required: ['taskId', 'testId'],
    },
  },
  {
    name: 'delete_test',
    description: 'Delete a test from a task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID.' },
        testId: { type: 'string', description: 'Test ID.' },
      },
      required: ['taskId', 'testId'],
    },
  },

  // --- Outputs ---
  {
    name: 'add_output',
    description: 'Add an output artifact to a task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID.' },
        label: { type: 'string', description: 'Output label/name.' },
        url: { type: 'string', description: 'Optional URL for the artifact.' },
      },
      required: ['taskId', 'label'],
    },
  },
  {
    name: 'delete_output',
    description: 'Delete an output artifact from a task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID.' },
        outputId: { type: 'string', description: 'Output ID.' },
      },
      required: ['taskId', 'outputId'],
    },
  },

  // --- Schedule ---
  {
    name: 'get_schedule_today',
    description: 'Get all schedule slots for today, enriched with assigned task data.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_schedule_week',
    description: 'Get the full week plan, slots, and goal allocations for a given week.',
    inputSchema: {
      type: 'object',
      properties: {
        weekStart: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: 'Any date in the target week (YYYY-MM-DD). Defaults to current week if omitted.',
        },
      },
    },
  },
  {
    name: 'generate_week_plan',
    description: 'Generate a new week plan with 84 slots and goal allocations. Returns 409 if a plan already exists for that week.',
    inputSchema: {
      type: 'object',
      properties: {
        weekStart: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: 'Any date in the target week (YYYY-MM-DD). Defaults to current week if omitted.',
        },
      },
    },
  },
  {
    name: 'assign_task_to_slot',
    description: 'Assign a task to a schedule slot. Handles releasing any existing task/slot associations.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to assign.' },
        slotId: { type: 'string', description: 'Schedule slot ID.' },
      },
      required: ['taskId', 'slotId'],
    },
  },
  {
    name: 'unassign_task_from_slot',
    description: 'Remove the task assignment from a schedule slot, reverting both slot and task to pending.',
    inputSchema: {
      type: 'object',
      properties: {
        slotId: { type: 'string', description: 'Schedule slot ID.' },
      },
      required: ['slotId'],
    },
  },
  {
    name: 'mark_slot_done',
    description: 'Mark a schedule slot as done, optionally attaching a note.',
    inputSchema: {
      type: 'object',
      properties: {
        slotId: { type: 'string', description: 'Schedule slot ID.' },
        note: { type: 'string', description: 'Optional completion note.' },
      },
      required: ['slotId'],
    },
  },
  {
    name: 'skip_slot',
    description: 'Mark a schedule slot as skipped, optionally with a reason.',
    inputSchema: {
      type: 'object',
      properties: {
        slotId: { type: 'string', description: 'Schedule slot ID.' },
        reason: { type: 'string', description: 'Optional reason for skipping.' },
      },
      required: ['slotId'],
    },
  },
  {
    name: 'update_slot',
    description: 'Update arbitrary fields on a schedule slot (status, taskId, note).',
    inputSchema: {
      type: 'object',
      properties: {
        slotId: { type: 'string', description: 'Schedule slot ID.' },
        status: {
          type: 'string',
          enum: ['pending', 'in-progress', 'done', 'skipped'],
        },
        taskId: { type: ['string', 'null'], description: 'Set null to unassign task.' },
        note: { type: ['string', 'null'], description: 'Set null to clear note.' },
      },
      required: ['slotId'],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>;

async function dispatch(name: string, args: Args): Promise<unknown> {
  switch (name) {
    // Health / Board
    case 'health': {
      const allGoals = await goalsService.listGoals({});
      return { status: 'ok', goals: allGoals.length };
    }
    case 'get_board':
      return boardService.getBoard();

    // Goals
    case 'list_goals':
      return goalsService.listGoals({ focus: args.focus as string | undefined });
    case 'get_goal':
      return goalsService.getGoal(args.id as string);
    case 'create_goal':
      return goalsService.createGoal({
        emoji: args.emoji as string,
        name: args.name as string,
        focus: (args.focus as 'sprint' | 'steady' | 'simmer' | 'dormant' | undefined) ?? 'steady',
        timeline: args.timeline as string | undefined,
        story: args.story as string | undefined,
      });
    case 'update_goal':
      return goalsService.updateGoal(args.id as string, {
        emoji: args.emoji as string | undefined,
        name: args.name as string | undefined,
        focus: args.focus as 'sprint' | 'steady' | 'simmer' | 'dormant' | undefined,
        timeline: args.timeline as string | null | undefined,
        story: args.story as string | null | undefined,
        sortOrder: args.sortOrder as number | undefined,
      });
    case 'delete_goal':
      await goalsService.deleteGoal(args.id as string);
      return { deleted: true };

    // Initiatives
    case 'list_initiatives':
      return initiativesService.listInitiatives({
        goalId: args.goalId as string | undefined,
        status: args.status as string | undefined,
      });
    case 'get_initiative':
      return initiativesService.getInitiative(args.id as string);
    case 'create_initiative':
      return initiativesService.createInitiative({
        emoji: args.emoji as string,
        name: args.name as string,
        goalId: args.goalId as string | undefined,
        mission: args.mission as string | undefined,
        status: (args.status as 'active' | 'backlog' | 'paused' | 'completed' | undefined) ?? 'active',
      });
    case 'update_initiative':
      return initiativesService.updateInitiative(args.id as string, {
        emoji: args.emoji as string | undefined,
        name: args.name as string | undefined,
        status: args.status as 'active' | 'backlog' | 'paused' | 'completed' | undefined,
        mission: args.mission as string | null | undefined,
        goalId: args.goalId as string | null | undefined,
        sortOrder: args.sortOrder as number | undefined,
      });
    case 'complete_initiative':
      return initiativesService.completeInitiative(args.id as string);
    case 'delete_initiative':
      await initiativesService.deleteInitiative(args.id as string);
      return { deleted: true };

    // Tasks
    case 'list_tasks':
      return tasksService.listTasks({
        initiativeId: args.initiativeId as string | undefined,
        status: args.status as string | string[] | undefined,
      });
    case 'get_task':
      return tasksService.getTask(args.id as string);
    case 'create_task':
      return tasksService.createTask({
        name: args.name as string,
        objective: args.objective as string,
        initiativeId: args.initiativeId as string | undefined,
        emoji: args.emoji as string | undefined,
        requirements: (args.requirements as string[] | undefined) ?? [],
        tests: (args.tests as string[] | undefined) ?? [],
      });
    case 'update_task':
      return tasksService.updateTask(args.id as string, {
        name: args.name as string | undefined,
        objective: args.objective as string | undefined,
        status: args.status as 'pending' | 'assigned' | 'in-progress' | 'done' | 'blocked' | 'cancelled' | undefined,
        sortOrder: args.sortOrder as number | undefined,
      });
    case 'start_task':
      return tasksService.startTask(args.id as string);
    case 'complete_task':
      return tasksService.doneTask(args.id as string, {
        summary: args.summary as string,
        outputs: (args.outputs as Array<{ label: string; url?: string }> | undefined) ?? null,
      });
    case 'block_task':
      return tasksService.blockTask(args.id as string, { reason: args.reason as string });
    case 'cancel_task':
      return tasksService.cancelTask(args.id as string);
    case 'delete_task':
      await tasksService.deleteTask(args.id as string);
      return { deleted: true };

    // Requirements
    case 'add_requirement':
      return tasksService.addRequirement(args.taskId as string, args.description as string);
    case 'update_requirement':
      return tasksService.updateRequirement(args.taskId as string, args.reqId as string, {
        description: args.description as string | undefined,
        completed: args.completed as boolean | undefined,
      });
    case 'check_requirement':
      return tasksService.checkRequirement(args.taskId as string, args.reqId as string, true);
    case 'uncheck_requirement':
      return tasksService.checkRequirement(args.taskId as string, args.reqId as string, false);
    case 'delete_requirement':
      await tasksService.deleteRequirement(args.taskId as string, args.reqId as string);
      return { deleted: true };

    // Tests
    case 'add_test':
      return tasksService.addTest(args.taskId as string, args.description as string);
    case 'update_test':
      return tasksService.updateTest(args.taskId as string, args.testId as string, {
        description: args.description as string | undefined,
        passed: args.passed as boolean | undefined,
      });
    case 'delete_test':
      await tasksService.deleteTest(args.taskId as string, args.testId as string);
      return { deleted: true };

    // Outputs
    case 'add_output':
      return tasksService.addOutput(args.taskId as string, args.label as string, args.url as string | undefined);
    case 'delete_output':
      await tasksService.deleteOutput(args.taskId as string, args.outputId as string);
      return { deleted: true };

    // Schedule
    case 'get_schedule_today':
      return scheduleService.getTodaySlots();
    case 'get_schedule_week':
      return scheduleService.getWeekSlots((args.weekStart as string | undefined) ?? today());
    case 'generate_week_plan':
      return scheduleService.generateWeekPlan(args.weekStart as string | undefined);
    case 'assign_task_to_slot':
      return scheduleService.assignTask(args.taskId as string, args.slotId as string);
    case 'unassign_task_from_slot':
      return scheduleService.unassignTask(args.slotId as string);
    case 'mark_slot_done':
      return scheduleService.doneSlot(args.slotId as string, { note: args.note as string | undefined });
    case 'skip_slot':
      return scheduleService.skipSlot(args.slotId as string, { reason: args.reason as string | undefined });
    case 'update_slot':
      return scheduleService.updateSlot(args.slotId as string, {
        status: args.status as 'pending' | 'in-progress' | 'done' | 'skipped' | undefined,
        taskId: args.taskId as string | null | undefined,
        note: args.note as string | null | undefined,
      });

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
