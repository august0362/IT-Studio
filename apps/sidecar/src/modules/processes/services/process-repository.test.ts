import { describe, expect, it } from 'vitest';
import { openDatabase, applyMigrations } from '../../../kernel/infra/sqlite/database.js';
import { ProcessRepository } from '../../../kernel/infra/sqlite/process-repository.js';
import { ProcessRegistry } from './process-registry.js';
import { createFakeClock } from '../../../kernel/infra/clock.js';
import { systemIdGenerator } from '../../../kernel/infra/id.js';
import { createLogger } from '../../../kernel/infra/logger.js';
import { EventBus } from '../../../kernel/rpc/event-bus.js';
import { conversationIdSchema } from '../../../kernel/validation/brand.js';

describe('SQLite process repository', () => {
  it('migrates idempotently and persists graph JSON, safe replay parameters, updates and removals', () => {
    const opened = openDatabase(':memory:');
    const registry = new ProcessRegistry({
      repository: new ProcessRepository(opened.db),
      events: new EventBus(),
      clock: createFakeClock(),
      ids: systemIdGenerator,
      logger: createLogger({ streams: [] }),
      dispatch: () => Promise.resolve({ ok: true, value: undefined }),
      cancelRecovered: () => Promise.resolve({ ok: true, value: undefined }),
    });
    try {
      applyMigrations(opened.db);
      const id = registry.start('chat', {
        title: 'Stored',
        operation: {
          kind: 'chat',
          params: {
            conversationId: conversationIdSchema.parse('10000000-0000-4000-8000-000000000001'),
            text: 'Hello',
          },
        },
      });
      registry.module(id, 'router', { state: 'active', detail: { model: 'test', attempts: [] } });
      registry.flush();
      const repository = new ProcessRepository(opened.db);
      expect(repository.load()).toMatchObject([
        {
          process: {
            id,
            modules: expect.arrayContaining([
              expect.objectContaining({ id: 'router', detail: { model: 'test', attempts: [] } }),
            ]) as unknown,
          },
          operation: { kind: 'chat', params: { text: 'Hello' } },
        },
      ]);
      registry.end(id, 'Done');
      registry.flush();
      expect(repository.load()[0]?.process.status).toBe('ended');
      registry.delete(id);
      registry.flush();
      expect(repository.load()).toEqual([]);
    } finally {
      registry.stop();
      opened.client.close();
    }
  });
});
