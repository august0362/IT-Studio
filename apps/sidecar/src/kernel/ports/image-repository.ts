import type { ImageAsset, ImageAssetId, ProjectId } from '@itstudio/schemas';

export interface IImageRepository {
  insert(asset: ImageAsset): Promise<void>;
  list(projectId: ProjectId): Promise<readonly ImageAsset[]>;
  get(assetId: ImageAssetId): Promise<ImageAsset | null>;
  delete(assetId: ImageAssetId): Promise<boolean>;
}
