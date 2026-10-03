import { asc, eq } from 'drizzle-orm';
import type { ImageAsset, ImageAssetId, ProjectId } from '@itstudio/schemas';
import type { AppDatabase } from './database.js';
import { imageAssets } from './schema.js';
import type { IImageRepository } from '../../ports/image-repository.js';
import { imageAssetSchema } from '../../validation/image.js';

export class ImageRepository implements IImageRepository {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  insert(asset: ImageAsset): Promise<void> {
    this.db
      .insert(imageAssets)
      .values({
        id: asset.id,
        projectId: asset.projectId,
        provider: asset.provider,
        prompt: asset.prompt,
        revisedPrompt: asset.revisedPrompt ?? null,
        size: asset.size,
        mimeType: asset.mimeType,
        localPath: asset.localPath,
        cost: asset.cost,
        createdAt: asset.createdAt,
      })
      .run();
    return Promise.resolve();
  }

  list(projectId: ProjectId): Promise<readonly ImageAsset[]> {
    return Promise.resolve(
      this.db
        .select()
        .from(imageAssets)
        .where(eq(imageAssets.projectId, projectId))
        .orderBy(asc(imageAssets.createdAt))
        .all()
        .map(toAsset),
    );
  }

  get(assetId: ImageAssetId): Promise<ImageAsset | null> {
    const row = this.db.select().from(imageAssets).where(eq(imageAssets.id, assetId)).get();
    return Promise.resolve(row === undefined ? null : toAsset(row));
  }

  delete(assetId: ImageAssetId): Promise<boolean> {
    return Promise.resolve(this.db.delete(imageAssets).where(eq(imageAssets.id, assetId)).run().changes > 0);
  }
}

function toAsset(row: typeof imageAssets.$inferSelect): ImageAsset {
  return imageAssetSchema.parse({
    id: row.id,
    projectId: row.projectId,
    provider: row.provider,
    prompt: row.prompt,
    ...(row.revisedPrompt === null ? {} : { revisedPrompt: row.revisedPrompt }),
    size: row.size,
    mimeType: row.mimeType,
    localPath: row.localPath,
    cost: row.cost,
    createdAt: row.createdAt,
  });
}
