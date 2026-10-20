import type { Result } from '@itstudio/schemas';

export interface IBrowserLauncher {
  launch(executable: string, url: string): Result<void>;
}
