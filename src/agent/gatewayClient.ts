import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket, { type RawData } from 'ws';

export interface GatewayClientOptions {
  url: string;
  token?: string;
  deviceToken?: string;
  scopes?: string[];
  clientDisplayName?: string;
  clientVersion?: string;
  deviceTokenStorePath?: string;
  requestTimeoutMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  connectChallengeTimeoutMs?: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error' | 'debug'>;
}

export interface HelloOk {
  type: 'hello-ok';
  protocol: number;
  server: { version: string; connId: string };
  features: { methods: string[]; events: string[] };
  policy: { maxPayload: number; maxBufferedBytes: number; tickIntervalMs: number };
  auth?: { deviceToken: string; role: string; scopes: string[]; issuedAtMs?: number };
  snapshot?: unknown;
}

type EventHandler = (payload: unknown) => void;

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout | null;
};

interface ResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

interface EventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
}

export class GatewayRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'GatewayRequestError';
  }
}

/**
 * Thin client for the OpenClaw Gateway protocol v3.
 *
 * Handshake:
 *   1. Open WS.
 *   2. Server emits `event: connect.challenge { nonce }`.
 *   3. Client sends `req: connect` with token auth.
 *   4. Server replies with HelloOk (may include a fresh deviceToken).
 *
 * After hello-ok, we watch `tick` events; if silent for 2× the server's
 * tickIntervalMs we force a reconnect.
 */
export class GatewayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private subscriptions = new Map<string, Set<EventHandler>>();
  private connectNonce: string | null = null;
  private connectPending: { resolve: () => void; reject: (err: Error) => void } | null = null;
  private connectReqId: string | null = null;
  private challengeTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private tickIntervalMs = 30_000;
  private lastTickAt = 0;
  private backoffMs: number;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private _helloOk: HelloOk | null = null;
  private _deviceToken: string | undefined;
  private _lastHelloAt: string | undefined;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error' | 'debug'>;

  constructor(private readonly opts: GatewayClientOptions) {
    super();
    this.backoffMs = opts.initialBackoffMs ?? 1_000;
    this._deviceToken = opts.deviceToken ?? this.loadStoredDeviceToken();
    this.log = opts.logger ?? console;
  }

  get isReady(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this._helloOk !== null;
  }

  get deviceToken(): string | undefined {
    return this._deviceToken;
  }

  get lastHelloAt(): string | undefined {
    return this._lastHelloAt;
  }

  /** Resolves when the first hello-ok is received. Later reconnects happen silently. */
  connect(): Promise<void> {
    if (this.closed) throw new Error('GatewayClient closed');
    if (this.isReady) return Promise.resolve();
    if (this.connectPending) {
      return new Promise((resolve, reject) => {
        const prior = this.connectPending!;
        this.connectPending = {
          resolve: () => {
            prior.resolve();
            resolve();
          },
          reject: (err) => {
            prior.reject(err);
            reject(err);
          },
        };
      });
    }
    return new Promise<void>((resolve, reject) => {
      this.connectPending = { resolve, reject };
      this.openSocket();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.rejectAllPending(new Error('GatewayClient closed'));
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      await new Promise<void>((resolve) => {
        ws.once('close', () => resolve());
        try {
          ws.close();
        } catch {
          resolve();
        }
      });
    }
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('gateway client not connected');
    }
    const id = randomUUID();
    const frame = { type: 'req' as const, id, method, params };
    return this.sendRequestFrame<T>(frame);
  }

  subscribe(eventName: string, handler: EventHandler): () => void {
    let set = this.subscriptions.get(eventName);
    if (!set) {
      set = new Set();
      this.subscriptions.set(eventName, set);
    }
    set.add(handler);
    return () => {
      const current = this.subscriptions.get(eventName);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.subscriptions.delete(eventName);
    };
  }

  // ---- internals ---------------------------------------------------------

  private sendRequestFrame<T>(frame: {
    type: 'req';
    id: string;
    method: string;
    params?: unknown;
  }): Promise<T> {
    const timeoutMs = this.opts.requestTimeoutMs ?? 30_000;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(frame.id);
        reject(new Error(`gateway request timeout: ${frame.method}`));
      }, timeoutMs);
      this.pending.set(frame.id, {
        resolve: (payload) => resolve(payload as T),
        reject,
        timer,
      });
      try {
        this.ws!.send(JSON.stringify(frame));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(frame.id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private openSocket(): void {
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    this.connectNonce = null;
    this.connectReqId = null;
    this._helloOk = null;

    ws.on('open', () => {
      this.armChallengeTimeout();
    });

    ws.on('message', (data: RawData) => {
      this.handleMessage(data.toString('utf8'));
    });

    ws.on('close', (code, reasonBuf) => {
      const reason = reasonBuf?.toString?.('utf8') ?? '';
      if (this.ws === ws) this.ws = null;
      this.clearChallengeTimeout();
      this.stopTickWatch();
      const err = new Error(`gateway closed (${code}): ${reason || 'no reason'}`);
      this.rejectAllPending(err);
      this._helloOk = null;
      if (this.connectPending && !this.closed) {
        // Initial connect failed: reject so caller can react.
        const pending = this.connectPending;
        this.connectPending = null;
        pending.reject(err);
      }
      this.emit('close', { code, reason });
      if (!this.closed) this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.log.warn?.(`[gateway] socket error: ${String(err)}`);
      // Close handler will drive reconnect.
    });
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const frame = parsed as { type?: string };

    if (frame.type === 'event') {
      this.handleEventFrame(parsed as EventFrame);
      return;
    }
    if (frame.type === 'res') {
      this.handleResponseFrame(parsed as ResponseFrame);
      return;
    }
  }

  private handleEventFrame(evt: EventFrame): void {
    if (evt.event === 'connect.challenge') {
      const payload = (evt.payload ?? {}) as { nonce?: string };
      const nonce = typeof payload.nonce === 'string' ? payload.nonce.trim() : '';
      if (!nonce) {
        this.failHandshake(new Error('connect.challenge missing nonce'));
        return;
      }
      this.connectNonce = nonce;
      this.sendConnect();
      return;
    }

    this.lastTickAt = Date.now();
    const handlers = this.subscriptions.get(evt.event);
    if (!handlers) return;
    for (const h of handlers) {
      try {
        h(evt.payload);
      } catch (err) {
        this.log.warn?.(`[gateway] handler for "${evt.event}" threw: ${String(err)}`);
      }
    }
  }

  private handleResponseFrame(res: ResponseFrame): void {
    this.lastTickAt = Date.now();

    if (this.connectReqId && res.id === this.connectReqId) {
      this.connectReqId = null;
      this.clearChallengeTimeout();
      if (res.ok) {
        const hello = res.payload as HelloOk;
        this.onHelloOk(hello);
      } else {
        const err = new GatewayRequestError(
          res.error?.message ?? 'gateway connect failed',
          res.error?.code ?? 'unknown',
          res.error?.details,
        );
        this.failHandshake(err);
      }
      return;
    }

    const pending = this.pending.get(res.id);
    if (!pending) return;
    this.pending.delete(res.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (res.ok) {
      pending.resolve(res.payload);
    } else {
      pending.reject(
        new GatewayRequestError(
          res.error?.message ?? 'gateway request failed',
          res.error?.code ?? 'unknown',
          res.error?.details,
        ),
      );
    }
  }

  private onHelloOk(hello: HelloOk): void {
    this._helloOk = hello;
    this._lastHelloAt = new Date().toISOString();
    this.tickIntervalMs = hello.policy?.tickIntervalMs ?? 30_000;
    this.lastTickAt = Date.now();
    this.backoffMs = this.opts.initialBackoffMs ?? 1_000;
    if (hello.auth?.deviceToken) {
      this._deviceToken = hello.auth.deviceToken;
      this.persistDeviceToken(hello.auth.deviceToken);
    }
    this.startTickWatch();
    if (this.connectPending) {
      this.connectPending.resolve();
      this.connectPending = null;
    }
    this.emit('ready', hello);
  }

  private sendConnect(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.connectNonce) return;
    if (this.connectReqId) return;
    const id = randomUUID();
    this.connectReqId = id;
    const auth: Record<string, string> = {};
    if (this._deviceToken) auth.deviceToken = this._deviceToken;
    else if (this.opts.token) auth.token = this.opts.token;
    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'gateway-client' as const,
        displayName: this.opts.clientDisplayName ?? 'mission-control-api',
        version: this.opts.clientVersion ?? '1.0.0',
        platform: process.platform,
        mode: 'backend' as const,
      },
      role: 'operator',
      scopes: this.opts.scopes ?? ['operator.admin', 'operator.read', 'operator.write'],
      ...(Object.keys(auth).length > 0 ? { auth } : {}),
    };
    const frame = { type: 'req' as const, id, method: 'connect', params };
    try {
      this.ws.send(JSON.stringify(frame));
    } catch (err) {
      this.failHandshake(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private armChallengeTimeout(): void {
    const ms = this.opts.connectChallengeTimeoutMs ?? 5_000;
    this.clearChallengeTimeout();
    this.challengeTimer = setTimeout(() => {
      this.failHandshake(new Error('gateway connect challenge timeout'));
      try {
        this.ws?.close(1008, 'challenge timeout');
      } catch {
        /* ignore */
      }
    }, ms);
  }

  private clearChallengeTimeout(): void {
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }
  }

  private startTickWatch(): void {
    this.stopTickWatch();
    const checkMs = Math.max(5_000, Math.floor(this.tickIntervalMs / 2));
    this.tickTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastTickAt > this.tickIntervalMs * 2) {
        this.log.warn?.('[gateway] tick watchdog: no tick for 2× interval, forcing reconnect');
        try {
          this.ws.close(4000, 'tick watchdog');
        } catch {
          /* ignore */
        }
      }
    }, checkMs);
    this.tickTimer.unref?.();
  }

  private stopTickWatch(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer) return;
    const max = this.opts.maxBackoffMs ?? 30_000;
    const delay = Math.min(this.backoffMs, max);
    this.backoffMs = Math.min(Math.floor(this.backoffMs * 2), max);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closed) return;
      this.openSocket();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private failHandshake(err: Error): void {
    this.clearChallengeTimeout();
    if (this.connectPending) {
      this.connectPending.reject(err);
      this.connectPending = null;
    }
    try {
      this.ws?.close(1008, err.message.slice(0, 100));
    } catch {
      /* ignore */
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  // ---- deviceToken persistence ------------------------------------------

  private loadStoredDeviceToken(): string | undefined {
    const path = this.opts.deviceTokenStorePath;
    if (!path) return undefined;
    try {
      const raw = readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw) as { deviceToken?: unknown };
      return typeof parsed.deviceToken === 'string' ? parsed.deviceToken : undefined;
    } catch {
      return undefined;
    }
  }

  private persistDeviceToken(token: string): void {
    const path = this.opts.deviceTokenStorePath;
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ deviceToken: token }, null, 2), { mode: 0o600 });
    } catch (err) {
      this.log.warn?.(`[gateway] failed to persist deviceToken: ${String(err)}`);
    }
  }
}

// ---- Singleton bootstrap ------------------------------------------------

let singleton: GatewayClient | null = null;

export function getGatewayClient(): GatewayClient {
  if (!singleton) throw new Error('GatewayClient not initialized — call initGatewayClient() first');
  return singleton;
}

export function initGatewayClient(opts: GatewayClientOptions): GatewayClient {
  if (singleton) return singleton;
  singleton = new GatewayClient(opts);
  return singleton;
}

export function resetGatewayClientForTests(): void {
  singleton = null;
}
