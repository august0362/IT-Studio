import {
  ErrorCode,
  type AppError,
  type Result,
  type RpcMethod,
  type RpcMethodMap,
  type RpcNotificationMap,
  type RpcNotificationName,
} from '@itstudio/schemas';
import { rpcParamsSchemas, rpcRequestEnvelopeSchema } from '../validation/ipc.js';
import type { Logger } from 'pino';
import type { EventBus } from './event-bus.js';
import type { LineTransport } from './line-transport.js';

export interface RpcContext {
  readonly requestId: number;
}

type RpcHandler<M extends RpcMethod> = (
  params: RpcMethodMap[M]['params'],
  context: RpcContext,
) => Promise<Result<RpcMethodMap[M]['result']>>;
type ErasedHandler = (params: unknown, context: RpcContext) => Promise<Result<unknown>>;

function appError(code: AppError['code'], message: string, details?: AppError['details']): AppError {
  return { code, message, retryable: false, ...(details === undefined ? {} : { details }) };
}

export class RpcServer {
  private readonly handlers = new Map<RpcMethod, ErasedHandler>();
  private readonly transport: LineTransport;
  private readonly events: EventBus<RpcNotificationMap>;
  private readonly logger: Logger;

  constructor(transport: LineTransport, events: EventBus<RpcNotificationMap>, logger: Logger) {
    this.transport = transport;
    this.events = events;
    this.logger = logger;
    for (const name of NOTIFICATION_NAMES) {
      events.subscribe(name, (params) => {
        void this.transport.write({ jsonrpc: '2.0', method: name, params });
      });
    }
  }

  register<M extends RpcMethod>(method: M, handler: RpcHandler<M>): void {
    this.handlers.set(method, (params, context) => handler(params as RpcMethodMap[M]['params'], context));
  }

  async handleLine(line: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      await this.protocolError(null, -32700, 'Parse error');
      return;
    }

    const envelope = rpcRequestEnvelopeSchema.safeParse(message);
    if (!envelope.success) {
      await this.protocolError(null, -32600, 'Invalid request');
      return;
    }
    const { id, method } = envelope.data;
    if (!Object.hasOwn(rpcParamsSchemas, method)) {
      await this.protocolError(id, -32601, 'Method not found');
      return;
    }
    const rpcMethod = method as RpcMethod;
    const paramsResult = rpcParamsSchemas[rpcMethod].safeParse((message as { readonly params?: unknown }).params);
    if (!paramsResult.success) {
      await this.respondError(
        id,
        -32602,
        'Invalid params',
        appError(ErrorCode.VALIDATION, 'Request parameters failed validation', {
          issues: paramsResult.error.issues.map((issue) => ({
            path: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        }),
      );
      return;
    }
    const handler = this.handlers.get(rpcMethod);
    if (handler === undefined) {
      await this.protocolError(id, -32601, 'Method not found');
      return;
    }
    try {
      const result = await handler(paramsResult.data, { requestId: id });
      if (result.ok) await this.transport.write({ jsonrpc: '2.0', id, result: result.value });
      else await this.respondError(id, -32000, result.error.message, result.error);
    } catch (error) {
      this.logger.error({ err: error, requestId: id, method }, 'RPC handler threw');
      await this.respondError(id, -32000, 'Internal error', appError(ErrorCode.INTERNAL, 'An internal error occurred'));
    }
  }

  private async protocolError(id: number | null, code: number, message: string): Promise<void> {
    await this.transport.write({
      jsonrpc: '2.0',
      id,
      error: { code, message, data: appError(ErrorCode.VALIDATION, message) },
    });
  }

  private async respondError(id: number, code: number, message: string, error: AppError): Promise<void> {
    await this.transport.write({ jsonrpc: '2.0', id, error: { code, message, data: error } });
  }
}

const NOTIFICATION_NAMES: readonly RpcNotificationName[] = [
  'system.ready',
  'chat.delta',
  'chat.completed',
  'chat.failed',
  'router.event',
  'router.fallbackRequired',
  'ledger.entry',
  'budget.alert',
  'pricing.updated',
  'rag.progress',
  'pipeline.event',
  'pipeline.failureReport',
  'vscode.status',
  'vscode.diagnostics',
  'workflow.activity',
];
