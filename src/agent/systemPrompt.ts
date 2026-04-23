import { today } from '../types/index.types.js';

/**
 * Build the `systemPrompt` override passed to the gateway `agent` RPC.
 *
 * The gateway already loads SOUL.md and the agent workspace bootstrap from
 * OpenClaw's agent config, so this body stays intentionally small. It only
 * assembles:
 *
 *   - Optional Phase 3 context additions (null in Phase 2).
 *   - A short date/ops footer so the agent knows today's date and which
 *     Mission Control agent identity it's answering as.
 *
 * Passing a non-empty string as `systemPrompt` on the `agent` RPC replaces
 * OpenClaw's resolved prompt wholesale; we avoid that by keeping this layer
 * *additive* at the call site — callers that want the gateway's default prompt
 * pass `undefined` instead of the output of this function.
 */
export function buildSystemPrompt(agentId: string, additions?: string): string {
  const sections: string[] = [];
  if (additions && additions.trim().length > 0) {
    sections.push(additions.trim());
  }
  sections.push(`Today is ${today()}. You are agent \`${agentId}\` in Mission Control.`);
  return sections.join('\n\n');
}
