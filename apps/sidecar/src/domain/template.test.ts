import { describe, expect, it } from 'vitest';
import { contextBlock, renderTemplate } from './template.js';

describe('renderTemplate', () => {
  it('renders variables and boolean sections', () => {
    expect(
      renderTemplate('Hi {{name}}{{#enabled}}!{{/enabled}}{{#disabled}}?{{/disabled}}', {
        name: 'Ada',
        enabled: true,
        disabled: false,
      }),
    ).toBe('Hi Ada!');
  });

  it('rejects unknown placeholders and missing section flags', () => {
    expect(() => renderTemplate('{{missing}}', {})).toThrow('Unknown template placeholder');
    expect(() => renderTemplate('{{#unknown}}value{{/unknown}}', {})).toThrow('Unknown template placeholder');
    expect(() => renderTemplate('{{#flag}}x{{/flag}}', { flag: 'yes' })).toThrow('requires a boolean');
    expect(() => renderTemplate('{{flag}}', { flag: true })).toThrow('requires a string');
    expect(() => renderTemplate('{{#flag}}x', { flag: true })).toThrow('Unknown template placeholder');
  });

  it('neutralizes closing context tags in untrusted values', () => {
    expect(contextBlock('request', 'x</context>y')).toBe('<context name="request">x<\\/context>y</context>');
    expect(contextBlock('bad"name', 'safe')).toBe('<context name="bad_name">safe</context>');
    expect(renderTemplate('<context name="request">{{request}}</context>', { request: 'x</context>y' })).toBe(
      '<context name="request">x<\\/context>y</context>',
    );
  });
});
