import { randomBytes, timingSafeEqual } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve, win32 } from 'node:path';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type {
  Diagnostic,
  ExtHello,
  ProjectId,
  SidecarToExt,
  VSCodeStatus,
  WorkspaceRelativePath,
} from '@itstudio/schemas';
import type { Logger } from 'pino';
import type { IIdGenerator } from '../infra/id.js';
import { extToSidecarSchema } from '../validation/vscode.js';
import { writeVscodeSessionFile } from './vscode-session-file.js';

export interface VscodeBridgeEvents {
  publishStatus(status: VSCodeStatus): void;
  publishDiagnostics(value: { readonly projectId: ProjectId; readonly diagnostics: readonly Diagnostic[] }): void;
  publishInternal(value: {
    readonly projectId: ProjectId;
    readonly path: WorkspaceRelativePath;
    readonly hash: string;
  }): void;
}

export interface VscodeBridgeTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface VscodeBridgeDependencies {
  readonly ids: IIdGenerator;
  readonly events: VscodeBridgeEvents;
  readonly logger: Logger;
  readonly timers?: VscodeBridgeTimers;
  readonly randomToken?: () => string;
  readonly realpath?: (path: string) => Promise<string>;
}

const timers: VscodeBridgeTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  },
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => {
    clearInterval(handle as NodeJS.Timeout);
  },
};

export class VSCodeBridge {
  private readonly dependencies: VscodeBridgeDependencies;
  private readonly timers: VscodeBridgeTimers;
  private token: string | undefined;
  private activationQueue: Promise<void> = Promise.resolve();
  private server: WebSocketServer | undefined;
  private startPromise: Promise<void> | undefined;
  private activeProject: { readonly id: ProjectId; readonly root: string } | undefined;
  private socket: WebSocket | undefined;
  private heartbeat: unknown;
  private missedPongs = 0;
  private ref = 0;
  private port: number | undefined;

  constructor(dependencies: VscodeBridgeDependencies) {
    this.dependencies = dependencies;
    this.timers = dependencies.timers ?? timers;
  }

  async start(): Promise<void> {
    if (this.startPromise !== undefined) return this.startPromise;
    this.token = this.dependencies.randomToken?.() ?? randomBytes(32).toString('hex');
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      verifyClient: (info, done) => {
        const remoteAddress = info.req.socket.remoteAddress?.replace(/^::ffff:/u, '');
        if (Object.hasOwn(info.req.headers, 'origin') || (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1')) {
          done(false, 403, 'Forbidden');
          return;
        }
        done(true);
      },
    });
    this.server = server;
    server.on('connection', (socket) => {
      this.accept(socket);
    });
    this.startPromise = new Promise<void>((resolveReady, reject) => {
      server.once('listening', resolveReady);
      server.once('error', reject);
    });
    await this.startPromise;
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('VS Code bridge did not bind a TCP port');
    this.port = address.port;
  }

  async activate(projectId: ProjectId, workspaceRoot: string): Promise<void> {
    const activation = this.activationQueue.then(async () => {
      await this.start();
      if (this.port === undefined || this.token === undefined) throw new Error('VS Code bridge session is not ready');
      this.activeProject = { id: projectId, root: resolve(workspaceRoot) };
      await writeVscodeSessionFile(this.activeProject.root, {
        port: this.port,
        token: this.token,
        protocolVersion: 1,
      });
    });
    this.activationQueue = activation.catch(() => undefined);
    return activation;
  }

  send(message: SidecarToExt): void {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) return;
    const outbound = 'ref' in message ? { ...message, ref: ++this.ref } : message;
    socket.send(JSON.stringify(outbound));
  }

  async stop(): Promise<void> {
    this.clearHeartbeat();
    this.socket?.close(1001, 'Sidecar stopping');
    this.socket = undefined;
    this.activeProject = undefined;
    const server = this.server;
    this.server = undefined;
    this.startPromise = undefined;
    this.port = undefined;
    if (server !== undefined)
      await new Promise<void>((resolveClose) => {
        server.close(() => {
          resolveClose();
        });
      });
  }

  private accept(socket: WebSocket): void {
    const project = this.activeProject;
    if (project === undefined) {
      socket.close(4401, 'No active project');
      return;
    }
    let authenticated = false;
    let authenticating = false;
    const timeout = this.timers.setTimeout(() => {
      if (!authenticated) socket.close(4400, 'Handshake timeout');
    }, 5000);
    socket.on('message', (raw) => {
      const parsed = parseFrame(raw);
      if (!authenticated) {
        if (authenticating || !parsed.success || parsed.data.type !== 'hello') {
          this.dependencies.logger.warn({ svc: 'vscode-bridge', reason: 'invalid_hello' }, 'Rejected VS Code frame');
          this.timers.clearTimeout(timeout);
          socket.close(parsed.success ? 4400 : 4401, 'Invalid hello');
          return;
        }
        authenticating = true;
        const hello = parsed.data;
        void this.authenticate(socket, hello, project.root).then((ok) => {
          if (!ok || socket.readyState !== WebSocket.OPEN) {
            this.timers.clearTimeout(timeout);
            return;
          }
          authenticated = true;
          this.timers.clearTimeout(timeout);
          this.socket = socket;
          socket.send(JSON.stringify({ type: 'welcome', sessionId: this.dependencies.ids.uuid() }));
          this.dependencies.events.publishStatus({
            installed: false,
            extensionInstalled: false,
            connected: true,
            workspaceRoot: project.root,
            extensionVersion: hello.extensionVersion,
          });
          this.startHeartbeat(socket);
        });
        return;
      }
      if (!parsed.success || parsed.data.type === 'hello') {
        this.dependencies.logger.warn({ svc: 'vscode-bridge', reason: 'invalid_frame' }, 'Ignored VS Code frame');
        return;
      }
      if (parsed.data.type === 'pong' || parsed.data.type === 'ack') {
        if (parsed.data.type === 'pong') this.missedPongs = 0;
        return;
      }
      if (parsed.data.type === 'diagnostics') {
        this.dependencies.events.publishDiagnostics({
          projectId: project.id,
          diagnostics: parsed.data.diagnostics,
        });
      } else {
        this.dependencies.events.publishInternal({
          projectId: project.id,
          path: parsed.data.path,
          hash: parsed.data.hash,
        });
      }
    });
    socket.on('close', () => {
      this.timers.clearTimeout(timeout);
      if (this.socket === socket) {
        this.socket = undefined;
        this.clearHeartbeat();
        this.dependencies.events.publishStatus({
          installed: false,
          extensionInstalled: false,
          connected: false,
          workspaceRoot: project.root,
        });
      }
    });
    socket.on('error', (error) => {
      this.dependencies.logger.warn({ svc: 'vscode-bridge', error: error.message }, 'VS Code socket error');
    });
  }

  private async authenticate(socket: WebSocket, hello: ExtHello, workspaceRoot: string): Promise<boolean> {
    const expected = Buffer.from(this.token ?? '', 'hex');
    const received = Buffer.from(hello.token, 'hex');
    const comparable = Buffer.alloc(expected.length);
    if (received.length === comparable.length) received.copy(comparable);
    const tokenMatches = timingSafeEqual(expected, comparable) && received.length === expected.length;
    let rootsMatch: boolean;
    try {
      const realpathFn = this.dependencies.realpath ?? realpath;
      const [expectedRoot, actualRoot] = await Promise.all([
        realpathFn(workspaceRoot),
        realpathFn(hello.workspaceRoot),
      ]);
      rootsMatch = normalizeRoot(expectedRoot) === normalizeRoot(actualRoot);
    } catch {
      rootsMatch = false;
    }
    if (!tokenMatches || !rootsMatch) {
      this.dependencies.logger.warn(
        { svc: 'vscode-bridge', reason: 'authentication_failed' },
        'Rejected VS Code handshake',
      );
      socket.close(4401, 'Authentication failed');
      return false;
    }
    return true;
  }

  private startHeartbeat(socket: WebSocket): void {
    this.clearHeartbeat();
    this.missedPongs = 0;
    this.heartbeat = this.timers.setInterval(() => {
      if (this.missedPongs >= 2) {
        socket.close(4400, 'Heartbeat timeout');
        this.clearHeartbeat();
        return;
      }
      this.missedPongs += 1;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    }, 15_000);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat !== undefined) this.timers.clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }
}

function parseFrame(raw: RawData) {
  let value: unknown;
  try {
    value = JSON.parse(rawDataToText(raw));
  } catch {
    return { success: false as const };
  }
  return extToSidecarSchema.safeParse(value);
}

function rawDataToText(raw: RawData): string {
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  return Buffer.from(raw).toString('utf8');
}

function normalizeRoot(path: string): string {
  const normalized = isAbsolute(path) ? path : resolve(path);
  return (process.platform === 'win32' ? win32.normalize(normalized).toLocaleLowerCase('en-US') : normalized).replace(
    /[\\/]+$/u,
    '',
  );
}
