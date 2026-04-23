export type AgentEventErrorCode =
  | 'daily_cap_exceeded'
  | 'timeout'
  | 'cancelled'
  | 'agent'
  | 'transport'
  | 'gateway_unreachable';

export type AgentEvent =
  | { type: 'session_started'; sessionId: string; invocationId: string; runId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      id: string;
      output: unknown;
      isError: boolean;
      durationMs: number;
      summary?: string;
    }
  | { type: 'message_complete'; messageId: string }
  | { type: 'done'; tokensIn: number; tokensOut: number }
  | { type: 'error'; error: string; code?: AgentEventErrorCode; fatal?: boolean }
  | { type: 'ping'; ts: string };

export type AgentEventType = AgentEvent['type'];

/**
 * Serialize an AgentEvent as a single SSE message. Trailing blank line
 * terminates each event per the SSE spec. Every event carries a JSON `data`
 * payload containing the full event object (including `type`), so a consumer
 * that ignores the SSE `event:` name still gets a well-formed record.
 */
export function serialize(e: AgentEvent): string {
  return `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}
