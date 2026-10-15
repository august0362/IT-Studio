import { lazy } from 'react';

export const PIPELINE_STUDIO_ENABLED = true as boolean;
export const PipelineStudioPage = lazy(() =>
  import('./PipelineStudioPage').then(({ PipelineStudioPage: page }) => ({ default: page })),
);
export { PipelineStudioNavButton } from './PipelineStudioNavButton';
export const ProcessCodePanel = lazy(() =>
  import('./ProcessCodePanel').then(({ ProcessCodePanel: panel }) => ({ default: panel })),
);
