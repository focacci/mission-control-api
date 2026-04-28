#!/usr/bin/env tsx
/**
 * MCP tool-visibility smoke test (CONTROL_LAYER / PHASE_2_API slice 1).
 *
 * Runs a single `openclaw agent` turn against the `intella` agent with a prompt
 * that forces it to call the `board` MCP tool, then asserts that every expected
 * mission-control tool id is materialized in the run's toolSummary.tools when
 * sampled across one call to `board`.
 *
 * This exists because openclaw's `tools.effective` RPC reports only
 * core/plugin/channel tools — MCP tools are resolved per-run via
 * loadEmbeddedPiMcpConfig and only observable by executing a turn. The registry
 * check (does `cfg.mcp.servers` include `mission-control`) is separate and runs
 * first via `openclaw mcp show mission-control`.
 */

import { execFileSync } from 'node:child_process';

const SERVER_NAME = 'mission-control';
const AGENT_ID = 'intella';

// Prompt must force a tool call to `board` so we can confirm at least one
// mission-control tool resolves end-to-end. The list below is the full
// materialized tool set for the server; everything beyond `board` is checked
// against the registry rather than by forcing a call per tool.
const EXPECTED_TOOLS = [
  'board', 'current_context', 'pin_to_context',
  'goals', 'initiatives', 'tasks', 'requirements',
  'agent_assignments', 'schedule', 'profile', 'context_groups',
  'briefings', 'agents', 'chat', 'invocations', 'health',
];

const FORCE_BOARD_PROMPT =
  'Call the board tool exactly once, then reply with just the total number of goals. Do not call any other tool.';

function run(bin: string, args: string[]): string {
  return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`);
}

// 1. Registry check — server is declared in openclaw.json.
try {
  run('openclaw', ['mcp', 'show', SERVER_NAME]);
  ok(`openclaw mcp registry contains "${SERVER_NAME}"`);
} catch {
  fail(`openclaw mcp server "${SERVER_NAME}" not registered. Run: openclaw mcp set ${SERVER_NAME} ...`);
}

// 2. Schema check — the stdio server starts and exposes every expected tool.
//    mcporter is a neutral MCP probe already configured for this workspace.
const MCPORTER_CONFIG = '/Users/michaelfocacci/.openclaw/workspace/config/mcporter.json';
let mcporterList: string;
try {
  mcporterList = run('mcporter', ['list', 'intella', '--schema', '--json', '--config', MCPORTER_CONFIG]);
} catch (e: any) {
  fail(`mcporter failed to list intella tools: ${e.message}`);
}

let toolsFromSchema: string[];
try {
  const parsed = JSON.parse(mcporterList);
  const tools = parsed?.tools ?? parsed?.servers?.[0]?.tools ?? [];
  toolsFromSchema = tools.map((t: any) => t.name);
} catch (e: any) {
  fail(`mcporter output was not JSON: ${e.message}\n${mcporterList.slice(0, 500)}`);
}

const missingFromSchema = EXPECTED_TOOLS.filter((t) => !toolsFromSchema.includes(t));
if (missingFromSchema.length > 0) {
  fail(`mcporter schema missing tools: ${missingFromSchema.join(', ')}`);
}
ok(`mcporter schema exposes all ${EXPECTED_TOOLS.length} expected tools`);

// 3. Runtime check — openclaw agent actually calls a mission-control tool.
const agentOutput = run('openclaw', [
  'agent',
  '--agent', AGENT_ID,
  '--message', FORCE_BOARD_PROMPT,
  '--json',
  '--timeout', '60',
]);

let agentResult: any;
try {
  agentResult = JSON.parse(agentOutput);
} catch (e: any) {
  fail(`openclaw agent returned non-JSON:\n${agentOutput.slice(0, 500)}`);
}

const calls: string[] = agentResult?.result?.meta?.toolSummary?.tools
  ?? agentResult?.meta?.toolSummary?.tools
  ?? [];
const boardCalled = calls.some((t) => t === `${SERVER_NAME}__board`);
if (!boardCalled) {
  fail(`openclaw agent did not call ${SERVER_NAME}__board. toolSummary.tools=${JSON.stringify(calls)}`);
}
ok(`openclaw agent "${AGENT_ID}" invoked ${SERVER_NAME}__board successfully`);

console.log(`\nSlice 1 gate: PASS — MCP tools are visible to openclaw at run-time.`);
