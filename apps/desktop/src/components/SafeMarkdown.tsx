import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { JSX } from 'react';
import { neutralClasses } from './ui/neutral-classes';

export interface SafeMarkdownProps {
  readonly source: string;
}

function isAllowedLink(uri: string | undefined): uri is string {
  if (uri === undefined) return false;
  return /^(https?:|mailto:)/i.test(uri);
}

const markdownComponents: Components = {
  a: ({ children, href }) =>
    isAllowedLink(href) ? (
      <a href={href} rel="noopener noreferrer" target="_blank">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt }) => <span>{alt ?? ''}</span>,
  pre: ({ children }) => (
    <pre className={`overflow-x-auto rounded border ${neutralClasses.border} bg-neutral-100 p-3`}>{children}</pre>
  ),
  code: ({ children, className }) => (
    <code className={`rounded bg-neutral-100 px-1 ${className ?? ''}`}>{children}</code>
  ),
};

export function SafeMarkdown({ source }: SafeMarkdownProps): JSX.Element {
  return (
    <div className="space-y-3">
      <ReactMarkdown
        components={markdownComponents}
        rehypePlugins={[rehypeSanitize]}
        remarkPlugins={[remarkGfm]}
        urlTransform={(uri) => (isAllowedLink(uri) ? uri : '')}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
