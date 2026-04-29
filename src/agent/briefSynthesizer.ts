import { findOrCreateSession } from '../services/conversations.service.js';
import { startInvocation } from '../services/invocations.service.js';
import type {
  BriefAccomplishmentItem,
  BriefAgentWorkItem,
  BriefBody,
  BriefKind,
  BriefProfileGapItem,
  BriefQuestionItem,
} from '../types/index.types.js';
import type { AgentEvent } from './events.js';
import { getGatewayClient } from './gatewayClient.js';
import { run } from './runner.js';

const DEFAULT_AGENT_ID = process.env.AGENT_BRIEF_ID ?? 'intella';
const DEFAULT_MODEL = process.env.AGENT_BRIEF_MODEL ?? process.env.AGENT_DEFAULT_MODEL ?? 'claude-sonnet-4.6';
const DEFAULT_TIMEOUT_SECONDS = Number(process.env.AGENT_BRIEF_TIMEOUT_SECONDS ?? 60);

const KIND_LABEL: Record<BriefKind, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

export interface SynthesizeBriefSummaryInput {
  briefId: string;
  kind: BriefKind;
  windowStart: string | null;
  windowEnd: string | null;
  body: BriefBody;
}

export interface SynthesizeBriefSummaryResult {
  summary: string | null;
  invocationId: string | null;
  /** Populated when synthesis was skipped or failed. UI surfaces this banner. */
  error?: string;
}

/**
 * Run the LLM pass that produces the brief's `summary` headline. Best-effort:
 * if the gateway isn't reachable or the run fails, returns `{ summary: null,
 * error }` so {@link finalizeBrief} can fall back to the deterministic summary
 * and tag `references.synthesisFailed = true`.
 *
 * Persists a `trigger='brief'` invocation tied to a `(brief, briefId)` session
 * so the synthesis transcript shows up in the standard invocation/timeline
 * views with `triggerRefId` pointing at the brief.
 */
export async function synthesizeBriefSummary(
  input: SynthesizeBriefSummaryInput,
): Promise<SynthesizeBriefSummaryResult> {
  const gateway = getGatewayClient();
  if (!gateway.isReady) {
    return { summary: null, invocationId: null, error: 'gateway not ready' };
  }

  const agentId = DEFAULT_AGENT_ID;
  const model = DEFAULT_MODEL;

  const session = await findOrCreateSession({
    agentId,
    contextType: 'brief',
    contextId: input.briefId,
  });

  const invocation = await startInvocation({
    trigger: 'brief',
    triggerRefId: input.briefId,
    agentId,
    sessionId: session.id,
    model,
  });

  const prompt = buildBriefSynthesisPrompt(input);

  let assistantBuffer = '';
  let lastAssistantText = '';
  const onEvent = (event: AgentEvent) => {
    if (event.type === 'text_delta') {
      assistantBuffer += event.text;
    } else if (event.type === 'message_complete') {
      if (assistantBuffer.length > 0) {
        lastAssistantText = assistantBuffer;
        assistantBuffer = '';
      }
    }
  };

  try {
    await run({
      invocationId: invocation.id,
      sessionId: session.id,
      agentId,
      model,
      timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
      initialUserMessage: prompt,
      onEvent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { summary: null, invocationId: invocation.id, error: message };
  }

  const trailing = assistantBuffer.length > 0 ? assistantBuffer : '';
  const finalText = (lastAssistantText || trailing).trim();
  if (!finalText) {
    return { summary: null, invocationId: invocation.id, error: 'empty synthesis output' };
  }

  return { summary: finalText, invocationId: invocation.id };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export function buildBriefSynthesisPrompt(input: SynthesizeBriefSummaryInput): string {
  const lines: string[] = [];
  const label = `${KIND_LABEL[input.kind]} brief`;
  lines.push(`You are writing the headline summary for the user's ${label}.`);
  if (input.windowStart && input.windowEnd) {
    lines.push(`Window covered: ${input.windowStart} → ${input.windowEnd} (local time).`);
  }
  lines.push('');
  lines.push('Evidence accumulated since the last brief:');
  lines.push('');
  lines.push(formatAgentWork(input.body.sections.agentWork));
  lines.push(formatAccomplishments(input.body.sections.userAccomplishments));
  lines.push(formatOpenQuestions(input.body.sections.openQuestions));
  lines.push(formatProfileGaps(input.body.sections.profileGaps));
  lines.push('');
  lines.push(
    'Write a 2–3 sentence narrative for the SUMMARY field of the brief. ' +
      'Lead with the most important thing the agent did since the last brief. ' +
      'Mention what the user accomplished if there is anything worth noting. ' +
      'If the agent is waiting on the user, surface that in one short clause. ' +
      'Keep the entire summary under 60 words. ' +
      'Output the summary text only — no preamble, no headers, no lists, no quotes.',
  );
  return lines.join('\n');
}

function formatAgentWork(items: BriefAgentWorkItem[]): string {
  if (items.length === 0) return '## Agent work\n(none)\n';
  const out: string[] = [`## Agent work (${items.length})`];
  for (const it of items) {
    const who = [it.agentEmoji, it.agentName].filter(Boolean).join(' ').trim() || it.agentId || 'agent';
    const tokens = `${it.tokensIn}/${it.tokensOut}`;
    const summary = it.oneLineSummary?.trim();
    out.push(`- [${who}] ${it.title}${summary ? ` — ${summary}` : ''} (tokens ${tokens})`);
  }
  out.push('');
  return out.join('\n');
}

function formatAccomplishments(items: BriefAccomplishmentItem[]): string {
  if (items.length === 0) return '## User accomplishments\n(none)\n';
  const out: string[] = [`## User accomplishments (${items.length})`];
  for (const it of items) {
    const detail = it.detail?.trim();
    out.push(`- [${it.source}] ${it.title}${detail ? ` — ${detail}` : ''}`);
  }
  out.push('');
  return out.join('\n');
}

function formatOpenQuestions(items: BriefQuestionItem[]): string {
  if (items.length === 0) return '## Open questions for the user\n(none)\n';
  const out: string[] = [`## Open questions for the user (${items.length})`];
  for (const it of items) {
    out.push(`- (${it.source}) ${it.prompt}`);
  }
  out.push('');
  return out.join('\n');
}

function formatProfileGaps(items: BriefProfileGapItem[]): string {
  if (items.length === 0) return '## Profile gaps\n(none)\n';
  const out: string[] = [`## Profile gaps (${items.length})`];
  for (const it of items) {
    out.push(`- ${it.prompt}`);
  }
  out.push('');
  return out.join('\n');
}
