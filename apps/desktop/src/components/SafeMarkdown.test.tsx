import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { XSS_CORPUS } from './__fixtures__/xss-corpus';
import { SafeMarkdown } from './SafeMarkdown';

afterEach(cleanup);

describe('SafeMarkdown', () => {
  it('renders common Markdown formatting', () => {
    render(
      <SafeMarkdown
        source={'# Heading\n\n- first\n- second\n\n| A | B |\n| - | - |\n| x | y |\n\n```ts\nconst value = 1;\n```'}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeVisible();
    expect(screen.getByRole('list').children).toHaveLength(2);
    expect(screen.getByRole('table')).toBeVisible();
    expect(screen.getByText('const value = 1;')).toBeVisible();
  });

  it('allows only safe external links and renders images as alt text', () => {
    const { container } = render(
      <SafeMarkdown
        source={
          '[https](https://example.com) [mail](mailto:a@example.com) [bad](javascript:alert(1)) ![image alt](https://example.com/image.png)'
        }
      />,
    );
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(screen.getByText('bad').tagName).toBe('SPAN');
    expect(screen.getByText('image alt').tagName).toBe('SPAN');
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps the full XSS corpus inert in the rendered DOM', () => {
    expect(XSS_CORPUS.length).toBeGreaterThanOrEqual(30);
    const { container } = render(<SafeMarkdown source={XSS_CORPUS.join('\n\n')} />);
    expect(container.querySelector('script, iframe, object, embed')).toBeNull();
    for (const element of container.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.name.toLowerCase()).not.toMatch(/^on/);
      }
      const href = element.getAttribute('href');
      if (href !== null) expect(href).not.toMatch(/^(javascript|data):/i);
    }
  });
});
