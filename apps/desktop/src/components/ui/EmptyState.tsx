import type { JSX, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function EmptyState({
  icon,
  description,
  action,
}: {
  readonly icon: IconName;
  readonly description: string;
  readonly action: ReactNode;
}): JSX.Element {
  return (
    <div className="studio-empty studio-empty-state">
      <div className="studio-empty-art" aria-hidden="true">
        <span className="studio-empty-orbit" />
        <span className="studio-empty-symbol">
          <Icon name={icon} />
        </span>
        <span className="studio-empty-brand">
          <Icon name="studio" />
        </span>
      </div>
      <p>{description}</p>
      <div className="mt-4">{action}</div>
    </div>
  );
}
