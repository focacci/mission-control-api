import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AppError } from '../types/index.types.js';
import { TOOLS, TOOLS_AS_MCP, dispatch } from '../agent/mcpBridge.js';

// Tool catalog and `dispatch` live in `src/agent/mcpBridge.ts` so the
// in-process agent runner (Phase 2) can reuse them without booting the
// stdio MCP plumbing. Re-exported here for existing import sites.
export { TOOLS, dispatch };

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'mission-control', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS_AS_MCP,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      const result = await dispatch(name, (args ?? {}) as Record<string, unknown>);
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
