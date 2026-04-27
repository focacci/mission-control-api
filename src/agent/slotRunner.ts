import {
  appendAgentOutputStep,
  completeAgentOutput,
  createAgentOutput,
  failAgentOutput,
} from '../services/agentOutputs.service.js';
import {
  forceInProgress,
  completeAgentAssignment,
  getAgentAssignment,
} from '../services/agentAssignments.service.js';
import { findOrCreateSession } from '../services/conversations.service.js';
import { startInvocation } from '../services/invocations.service.js';
import { doneSlot } from '../services/schedule.service.js';
import type { ScheduleSlotRow } from '../services/schedule.service.js';
import type { AgentEvent, AgentEventErrorCode } from './events.js';
import { run } from './runner.js';

const DEFAULT_AGENT_ID = 'intella';
const DEFAULT_MODEL = process.env.AGENT_DEFAULT_MODEL ?? 'claude-sonnet-4.6';

type AgentAssignmentRow = Awaited<ReturnType<typeof getAgentAssignment>>;

export function buildSlotPrompt(
  aa: { title: string | null; description: string | null },
  extraPrompt: string | null,
): string {
  const title = aa.title ?? '';
  const description = aa.description ?? '';
  const base = `Please complete the following Agent Assignment:\n\n${title}\n\n${description}`;
  if (extraPrompt && extraPrompt.trim().length > 0) {
    return `${base}\n\n${extraPrompt.trim()}`;
  }
  return base;
}

function stringifyToolOutput(output: unknown): string | null {
  if (output === null || output === undefined) return null;
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function statusFromCode(code?: AgentEventErrorCode): 'error' | 'cancelled' {
  return code === 'cancelled' ? 'cancelled' : 'error';
}

/**
 * Drive a single due slot through the agent. Never throws — all failures are
 * captured as failed Agent Outputs. The slot is left in `in-progress` on
 * failure; the caller (tick loop) does not retry.
 */
export async function runDueSlot(slot: ScheduleSlotRow): Promise<void> {
  if (!slot.agentAssignmentId) return;

  let aa: AgentAssignmentRow;
  try {
    aa = await getAgentAssignment(slot.agentAssignmentId);
  } catch (err) {
    console.warn(`[slotRunner] missing AA ${slot.agentAssignmentId} for slot ${slot.id}: ${String(err)}`);
    try {
      await doneSlot(slot.id, {});
    } catch {
      /* ignore */
    }
    return;
  }

  if (aa.status === 'done') {
    try {
      await doneSlot(slot.id, {});
    } catch {
      /* ignore */
    }
    return;
  }

  const agentId = aa.agentId ?? DEFAULT_AGENT_ID;
  const model = DEFAULT_MODEL;
  const prompt = buildSlotPrompt(aa, slot.extraPrompt);

  const session = await findOrCreateSession({
    agentId,
    contextType: 'slot',
    contextId: slot.id,
  });

  const invocation = await startInvocation({
    trigger: 'slot_start',
    triggerRefId: slot.id,
    agentId,
    sessionId: session.id,
    model,
  });

  const output = await createAgentOutput(aa.id, {
    agentId,
    input: prompt,
    model,
  });

  try {
    await forceInProgress(aa.id);
  } catch (err) {
    console.warn(`[slotRunner] forceInProgress failed for AA ${aa.id}: ${String(err)}`);
    await failAgentOutput(output.id, {
      error: `forceInProgress failed: ${err instanceof Error ? err.message : String(err)}`,
      status: 'error',
    });
    return;
  }

  // Serialize step writes so they don't interleave with completeAgentOutput.
  let stepQueue: Promise<void> = Promise.resolve();
  const enqueueStep = (fn: () => Promise<void>) => {
    stepQueue = stepQueue.then(fn).catch(err => {
      console.warn(`[slotRunner] step write failed: ${String(err)}`);
    });
    return stepQueue;
  };

  let assistantBuffer = '';
  let lastAssistantText = '';
  let pendingToolCall: {
    id: string;
    name: string;
    input: unknown;
    startedAtMs: number;
  } | null = null;
  let fatalCode: AgentEventErrorCode | undefined;

  const onEvent = (event: AgentEvent) => {
    switch (event.type) {
      case 'text_delta':
        assistantBuffer += event.text;
        return;
      case 'tool_use':
        pendingToolCall = {
          id: event.id,
          name: event.name,
          input: event.input,
          startedAtMs: Date.now(),
        };
        return;
      case 'tool_result': {
        const pending = pendingToolCall;
        pendingToolCall = null;
        const toolName = pending?.name ?? 'unknown';
        const toolInput = pending?.input ?? null;
        const durationMs =
          event.durationMs ??
          (pending ? Date.now() - pending.startedAtMs : 0);
        enqueueStep(() =>
          appendAgentOutputStep(output.id, {
            kind: 'tool_call',
            toolName,
            toolInput,
            toolOutput: stringifyToolOutput(event.output),
            isError: event.isError,
            durationMs,
          }).then(() => undefined),
        );
        return;
      }
      case 'message_complete': {
        if (assistantBuffer.length > 0) {
          const content = assistantBuffer;
          lastAssistantText = content;
          assistantBuffer = '';
          enqueueStep(() =>
            appendAgentOutputStep(output.id, {
              kind: 'text',
              content,
            }).then(() => undefined),
          );
        }
        return;
      }
      case 'error':
        if (event.fatal) fatalCode = event.code;
        return;
      default:
        return;
    }
  };

  try {
    const result = await run({
      invocationId: invocation.id,
      sessionId: session.id,
      agentId,
      model,
      initialUserMessage: prompt,
      onEvent,
    });

    // Make sure all queued step writes have flushed before completing.
    await stepQueue;

    // Flush any trailing buffered text the runner didn't terminate with a
    // message_complete (defensive — the runner's settleOk flushes its own
    // buffer, but our local buffer accumulates only via text_delta).
    if (assistantBuffer.length > 0) {
      const trailing = assistantBuffer;
      assistantBuffer = '';
      lastAssistantText = trailing;
      await appendAgentOutputStep(output.id, { kind: 'text', content: trailing });
    }

    await completeAgentOutput(output.id, {
      response: lastAssistantText,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });

    try {
      await doneSlot(slot.id, {});
    } catch (err) {
      console.warn(`[slotRunner] doneSlot failed for ${slot.id}: ${String(err)}`);
    }

    try {
      await completeAgentAssignment(aa.id);
    } catch (err) {
      console.warn(`[slotRunner] completeAgentAssignment failed for ${aa.id}: ${String(err)}`);
    }
  } catch (err) {
    await stepQueue.catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    try {
      await failAgentOutput(output.id, {
        error: message,
        status: statusFromCode(fatalCode),
      });
    } catch (failErr) {
      console.warn(`[slotRunner] failAgentOutput failed for ${output.id}: ${String(failErr)}`);
    }
  }
}
