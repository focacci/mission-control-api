/**
 * Tool-call presenters: render one-line summaries for the collapsed tool rows
 * in the iOS UI and for `tool_call_log.summary`. Presenters are pure — they
 * receive the raw input / output JSON and return short human strings.
 *
 * The runner looks up presenters by the bare tool name (post-strip of the
 * `mission-control__` namespace prefix). Unknown tools fall through to a
 * JSON-truncation formatter.
 *
 * Ship-with: `board`, `tasks`, `schedule`. Everything else uses the fallback
 * and can be upgraded later without a schema change.
 */

export interface ToolPresenter {
  argSummary(input: unknown): string;
  resultSummary(output: unknown, isError: boolean): string;
}

const MAX_SUMMARY_LEN = 140;

function truncate(s: string, max = MAX_SUMMARY_LEN): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function toObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function stringField(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function numberField(o: Record<string, unknown>, key: string): number | undefined {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function jsonFallback(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') return truncate(v);
  try {
    return truncate(JSON.stringify(v));
  } catch {
    return truncate(String(v));
  }
}

function errorSummary(output: unknown): string {
  const obj = toObject(output);
  const msg = stringField(obj, 'error') ?? stringField(obj, 'message') ?? jsonFallback(output);
  return `error: ${truncate(msg, MAX_SUMMARY_LEN - 'error: '.length)}`;
}

// ---------------------------------------------------------------------------
// board
// ---------------------------------------------------------------------------

const boardPresenter: ToolPresenter = {
  argSummary: () => 'board',
  resultSummary: (output, isError) => {
    if (isError) return errorSummary(output);
    const obj = toObject(output);
    const goals = toArray(obj.goals);
    const stats = toObject(obj.stats);
    const initiatives = numberField(stats, 'initiatives');
    const tasks = numberField(stats, 'tasks');
    const parts = [`${goals.length} goal${goals.length === 1 ? '' : 's'}`];
    if (initiatives !== undefined) parts.push(`${initiatives} initiatives`);
    if (tasks !== undefined) parts.push(`${tasks} tasks`);
    return parts.join(' · ');
  },
};

// ---------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------

const tasksPresenter: ToolPresenter = {
  argSummary: input => {
    const obj = toObject(input);
    const action = stringField(obj, 'action') ?? 'list';
    const name = stringField(obj, 'name');
    const id = stringField(obj, 'id');
    const status = stringField(obj, 'status');
    switch (action) {
      case 'list': {
        const filters: string[] = [];
        if (status) filters.push(`status=${status}`);
        const initiativeId = stringField(obj, 'initiativeId');
        if (initiativeId) filters.push(`initiative=${initiativeId}`);
        return filters.length ? `list ${filters.join(' ')}` : 'list';
      }
      case 'get':
        return id ? `get ${id}` : 'get';
      case 'create':
        return name ? `create "${truncate(name, 60)}"` : 'create';
      case 'update':
        return id ? `update ${id}` : 'update';
      case 'complete':
        return id ? `complete ${id}` : 'complete';
      case 'delete':
        return id ? `delete ${id}` : 'delete';
      default:
        return action;
    }
  },
  resultSummary: (output, isError) => {
    if (isError) return errorSummary(output);
    if (Array.isArray(output)) {
      return `${output.length} task${output.length === 1 ? '' : 's'}`;
    }
    const obj = toObject(output);
    const name = stringField(obj, 'displayName') ?? stringField(obj, 'name');
    const status = stringField(obj, 'status');
    if (name && status) return `${truncate(name, 80)} (${status})`;
    if (name) return truncate(name, 100);
    if (status) return status;
    return jsonFallback(output);
  },
};

// ---------------------------------------------------------------------------
// schedule
// ---------------------------------------------------------------------------

const schedulePresenter: ToolPresenter = {
  argSummary: input => {
    const obj = toObject(input);
    const action = stringField(obj, 'action') ?? 'week';
    const weekStart = stringField(obj, 'weekStart');
    const date = stringField(obj, 'date');
    const slotId = stringField(obj, 'slotId') ?? stringField(obj, 'id');
    switch (action) {
      case 'week':
        return weekStart ? `week ${weekStart}` : 'week (current)';
      case 'day':
        return date ? `day ${date}` : 'day';
      case 'slot':
        return slotId ? `slot ${slotId}` : 'slot';
      case 'assign':
      case 'update':
      case 'complete':
      case 'skip':
        return slotId ? `${action} ${slotId}` : action;
      default:
        return action;
    }
  },
  resultSummary: (output, isError) => {
    if (isError) return errorSummary(output);
    if (Array.isArray(output)) {
      return `${output.length} slot${output.length === 1 ? '' : 's'}`;
    }
    const obj = toObject(output);
    const slots = toArray(obj.slots);
    if (slots.length > 0) {
      const weekStart = stringField(obj, 'weekStart');
      return weekStart ? `${slots.length} slots · week ${weekStart}` : `${slots.length} slots`;
    }
    const status = stringField(obj, 'status');
    const time = stringField(obj, 'time') ?? stringField(obj, 'datetime');
    if (time && status) return `${time} · ${status}`;
    if (status) return status;
    return jsonFallback(output);
  },
};

// ---------------------------------------------------------------------------
// Fallback — covers every tool we haven't built a bespoke presenter for yet.
// ---------------------------------------------------------------------------

const fallbackPresenter: ToolPresenter = {
  argSummary: input => {
    const obj = toObject(input);
    const action = stringField(obj, 'action');
    if (action) {
      const id = stringField(obj, 'id');
      return id ? `${action} ${id}` : action;
    }
    return jsonFallback(input);
  },
  resultSummary: (output, isError) => {
    if (isError) return errorSummary(output);
    if (Array.isArray(output)) return `${output.length} item${output.length === 1 ? '' : 's'}`;
    return jsonFallback(output);
  },
};

export const PRESENTERS: Record<string, ToolPresenter> = {
  board: boardPresenter,
  tasks: tasksPresenter,
  schedule: schedulePresenter,
};

/** Strip the gateway MCP namespace prefix (`mission-control__`) if present. */
export function stripToolNamespace(name: string): string {
  const ix = name.lastIndexOf('__');
  return ix >= 0 ? name.slice(ix + 2) : name;
}

export function presenterFor(name: string): ToolPresenter {
  return PRESENTERS[stripToolNamespace(name)] ?? fallbackPresenter;
}

export function summarize(
  name: string,
  input: unknown,
  output: unknown,
  isError: boolean,
): { arg: string; result: string } {
  const p = presenterFor(name);
  return {
    arg: truncate(p.argSummary(input)),
    result: truncate(p.resultSummary(output, isError)),
  };
}
