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
  VSCodeSettings,
  WorkspaceRelativePath,
} from '@itstudio/schemas';
import type { Logger } from 'pino';
import type { IIdGenerator } from '../infra/id.js';
import { extToSidecarSchema } from '../validation/vscode.js';
import { writeVscodeSessionFile } from './vscode-session-file.js';
import type { WorkflowInternalEvent } from './workflow-internal-events.js';

type CloseReason = Extract<SidecarToExt, { type: 'close_window' }>['reason'];

interface WindowSession {
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly launchedByStudio: boolean;
  heartbeat?: unknown;
  missedPongs: number;
  closeRequest?: { readonly ref: number; readonly reason: CloseReason };
}

export interface VscodeBridgeEvents {
  publishStatus(status: VSCodeStatus): void;
  publishDiagnostics(value: { readonly projectId: ProjectId; readonly diagnostics: readonly Diagnostic[] }): void;
  publishInternal(value: {
    readonly projectId: ProjectId;
    readonly path: WorkspaceRelativePath;
    readonly hash: string;
  }): void;
  publishActivity?(value: WorkflowInternalEvent): void;
  windowClosed?(projectId: ProjectId, workspaceRoot: string, reason: CloseReason): void;
  windowDisconnected?(workspaceRoot: string): void;
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
  private readonly projects = new Map<ProjectId, string>();
  private readonly sessions = new Map<WebSocket, WindowSession>();
  private readonly launches: { projectId: ProjectId; workspaceRoot: string; launchedAt: number }[] = [];
  private readonly closing = new Map<number, { socket: WebSocket; finish: (outcome: string) => void }>();
  private ref = 0;
  private readonly pendingActions = new Map<
    number,
    { readonly action: 'reveal' | 'show_diff' | 'transaction' | 'notify'; readonly path?: WorkspaceRelativePath }
  >();
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
      this.projects.set(projectId, this.activeProject.root);
      this.socket = [...this.sessions].find(([, session]) => session.projectId === projectId)?.[0];
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
    if (message.type === 'close_window') return;
    if (socket?.readyState !== WebSocket.OPEN) return;
    const outbound = 'ref' in message ? { ...message, ref: ++this.ref } : message;
    if ('ref' in outbound && outbound.type !== 'request_diagnostics' && this.activeProject !== undefined) {
      const path =
        outbound.type === 'reveal' || outbound.type === 'show_diff'
          ? outbound.path
          : outbound.type === 'transaction'
            ? outbound.paths[0]
            : undefined;
      const action = outbound.type;
      this.pendingActions.set(outbound.ref, { action, ...(path === undefined ? {} : { path }) });
      this.dependencies.events.publishActivity?.({
        type: 'vscode',
        phase: 'sent',
        projectId: this.activeProject.id,
        action,
        ...(path === undefined ? {} : { path }),
      });
    }
    socket.send(JSON.stringify(outbound));
  }

  async stop(): Promise<void> {
    for (const [socket, session] of this.sessions) {
      this.clearHeartbeat(session);
      delete session.closeRequest;
      socket.close(1001, 'Sidecar stopping');
    }
    for (const pending of this.closing.values()) pending.finish('disconnected');
    this.sessions.clear();
    this.launches.length = 0;
    this.projects.clear();
    this.socket = undefined;
    this.activeProject = undefined;
    this.pendingActions.clear();
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
    let project: { id: ProjectId; root: string } | undefined;
    let session: WindowSession | undefined;
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
        void this.findProject(hello.workspaceRoot).then(async (matched) => {
          project = matched;
          if (matched === undefined) socket.close(4401, 'Authentication failed');
          const ok = matched !== undefined && (await this.authenticate(socket, hello, matched.root));
          if (!ok || project === undefined || socket.readyState !== WebSocket.OPEN) {
            this.timers.clearTimeout(timeout);
            return;
          }
          authenticated = true;
          this.timers.clearTimeout(timeout);
          const authenticatedProject = project;
          const launchIndex = this.launches.findIndex(
            (launch) =>
              launch.projectId === authenticatedProject.id &&
              normalizeRoot(launch.workspaceRoot) === normalizeRoot(authenticatedProject.root),
          );
          session = {
            projectId: project.id,
            workspaceRoot: project.root,
            launchedByStudio: launchIndex >= 0,
            missedPongs: 0,
          };
          if (launchIndex >= 0) this.launches.splice(launchIndex, 1);
          this.sessions.set(socket, session);
          if (this.activeProject?.id === project.id) this.socket = socket;
          socket.send(JSON.stringify({ type: 'welcome', sessionId: this.dependencies.ids.uuid() }));
          this.dependencies.events.publishStatus({
            installed: false,
            extensionInstalled: false,
            connected: true,
            workspaceRoot: project.root,
            extensionVersion: hello.extensionVersion,
          });
          this.startHeartbeat(socket, session);
        });
        return;
      }
      if (project === undefined || session === undefined) return;
      if (!parsed.success || parsed.data.type === 'hello') {
        this.dependencies.logger.warn({ svc: 'vscode-bridge', reason: 'invalid_frame' }, 'Ignored VS Code frame');
        return;
      }
      if (parsed.data.type === 'pong' || parsed.data.type === 'ack') {
        if (parsed.data.type === 'pong') session.missedPongs = 0;
        else {
          const pending = this.closing.get(parsed.data.ref);
          if (pending?.socket === socket && parsed.data.closed !== undefined)
            pending.finish(parsed.data.closed ? 'closed' : 'cancelled');
          else if (session.closeRequest?.ref === parsed.data.ref && parsed.data.closed !== undefined) {
            if (parsed.data.closed) this.windowClosed(session);
            else delete session.closeRequest;
          }
          const action = this.pendingActions.get(parsed.data.ref);
          this.pendingActions.delete(parsed.data.ref);
          if (action !== undefined)
            this.dependencies.events.publishActivity?.({
              type: 'vscode',
              phase: 'acked',
              projectId: project.id,
              action: action.action,
              ...(action.path === undefined ? {} : { path: action.path }),
            });
        }
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
      if (session === undefined) return;
      this.clearHeartbeat(session);
      this.sessions.delete(socket);
      for (const pending of this.closing.values()) {
        if (pending.socket === socket) pending.finish('closed');
      }
      this.windowClosed(session);
      if (session.launchedByStudio) this.dependencies.events.windowDisconnected?.(session.workspaceRoot);
      if (this.socket === socket)
        this.socket = [...this.sessions].find(([, value]) => value.projectId === this.activeProject?.id)?.[0];
      this.dependencies.events.publishStatus({
        installed: false,
        extensionInstalled: false,
        connected: this.socket !== undefined,
        workspaceRoot: session.workspaceRoot,
      });
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

  recordLaunch(projectId: ProjectId, workspaceRoot: string, launchedAt: number): void {
    this.launches.push({ projectId, workspaceRoot: resolve(workspaceRoot), launchedAt });
  }

  async closeWindows(settings: VSCodeSettings, reason: CloseReason, projectId?: ProjectId): Promise<void> {
    if (reason === 'studio_exit' ? !settings.closeWithStudio : !settings.closeWithProject) return;
    const timeoutMs = reason === 'studio_exit' ? 2000 : 3000;
    await Promise.all(
      [...this.sessions]
        .filter(
          ([, session]) =>
            (projectId === undefined || session.projectId === projectId) &&
            (session.launchedByStudio || settings.closeManuallyOpened),
        )
        .map(
          ([socket, session]) =>
            new Promise<void>((resolveClose) => {
              const ref = ++this.ref;
              session.closeRequest = { ref, reason };
              const timeout = this.timers.setTimeout(() => {
                finish('timeout');
              }, timeoutMs);
              const finish = (outcome: string): void => {
                if (!this.closing.delete(ref)) return;
                this.timers.clearTimeout(timeout);
                const context = { svc: 'vscode-bridge', projectId: session.projectId, reason, outcome, ref };
                if (outcome === 'timeout')
                  this.dependencies.logger.warn(context, 'VS Code close timed out (extension may be older)');
                else this.dependencies.logger.info(context, 'VS Code close completed');
                if (session.closeRequest?.ref === ref) {
                  if (outcome === 'closed') this.windowClosed(session);
                  else if (outcome !== 'timeout') delete session.closeRequest;
                }
                resolveClose();
              };
              this.closing.set(ref, { socket, finish });
              if (socket.readyState !== WebSocket.OPEN) {
                finish('disconnected');
                return;
              }
              socket.send(JSON.stringify({ type: 'close_window', ref, reason }), (error) => {
                if (error) finish('send_failed');
              });
            }),
        ),
    );
  }

  private windowClosed(session: WindowSession): void {
    const request = session.closeRequest;
    if (request === undefined) return;
    delete session.closeRequest;
    this.dependencies.events.windowClosed?.(session.projectId, session.workspaceRoot, request.reason);
  }

  private async findProject(workspaceRoot: string): Promise<{ id: ProjectId; root: string } | undefined> {
    try {
      const realpathFn = this.dependencies.realpath ?? realpath;
      const actual = normalizeRoot(await realpathFn(workspaceRoot));
      for (const [id, root] of this.projects) {
        if (normalizeRoot(await realpathFn(root)) === actual) return { id, root };
      }
    } catch (error) {
      this.dependencies.logger.warn(
        { svc: 'vscode-bridge', error: error instanceof Error ? error.message : 'unknown' },
        'Could not resolve VS Code workspace',
      );
    }
    return undefined;
  }

  private startHeartbeat(socket: WebSocket, session: WindowSession): void {
    session.heartbeat = this.timers.setInterval(() => {
      if (session.missedPongs >= 2) {
        socket.close(4400, 'Heartbeat timeout');
        this.clearHeartbeat(session);
        return;
      }
      session.missedPongs += 1;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    }, 15_000);
  }

  private clearHeartbeat(session: WindowSession): void {
    if (session.heartbeat !== undefined) this.timers.clearInterval(session.heartbeat);
    delete session.heartbeat;
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
