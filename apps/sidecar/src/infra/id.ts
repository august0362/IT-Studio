import { randomUUID } from 'node:crypto';

export interface IIdGenerator {
  uuid(): string;
}

export const systemIdGenerator: IIdGenerator = { uuid: randomUUID };

export function createFakeIdGenerator(ids: readonly string[] = ['fake-id']): IIdGenerator {
  let index = 0;
  return {
    uuid: () => {
      const id = ids[index];
      index += 1;
      return id ?? `fake-id-${String(index)}`;
    },
  };
}
