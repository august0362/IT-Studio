import type { JSX, ReactNode, Ref } from 'react';
import { Icon, type IconName } from './Icon';

export function PageHeader({
  title,
  subtitle,
  icon,
  action,
  id,
  level = 1,
  headingRef,
  focusable = false,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly icon: IconName;
  readonly action?: ReactNode;
  readonly id?: string;
  readonly level?: 1 | 2;
  readonly headingRef?: Ref<HTMLHeadingElement>;
  readonly focusable?: boolean;
}): JSX.Element {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <header className="studio-page-header">
      <span className="studio-page-emblem">
        <Icon name={icon} />
      </span>
      <div className="min-w-0 flex-1">
        <Heading
          className="text-2xl font-semibold tracking-tight"
          id={id}
          ref={headingRef}
          tabIndex={focusable ? -1 : undefined}
        >
          {title}
        </Heading>
        <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
      </div>
      {action ? <div className="studio-page-actions">{action}</div> : null}
    </header>
  );
}
