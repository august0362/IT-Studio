export type TemplateValue = string | boolean;

export function renderTemplate(template: string, values: Readonly<Record<string, TemplateValue>>): string {
  const sectionsRendered = template.replace(
    /\{\{#([A-Za-z][A-Za-z0-9]*)\}\}([\s\S]*?)\{\{\/\1\}\}/gu,
    (_match, name: string, body: string) => {
      if (!Object.hasOwn(values, name)) throw new Error(`Unknown template placeholder {{#${name}}}`);
      const value = values[name];
      if (typeof value !== 'boolean') throw new Error(`Template section "${name}" requires a boolean value`);
      return value ? body : '';
    },
  );
  return sectionsRendered
    .replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/gu, (_match, name: string) => {
      if (!Object.hasOwn(values, name)) throw new Error(`Unknown template placeholder {{${name}}}`);
      const value = values[name];
      if (typeof value !== 'string') throw new Error(`Template placeholder "${name}" requires a string value`);
      return value.replace(/<\/context\s*>/giu, '<\\/context>');
    })
    .replace(/\{\{[\s\S]*?\}\}/gu, (placeholder) => {
      throw new Error(`Unknown template placeholder ${placeholder}`);
    });
}

export function contextBlock(name: string, value: string): string {
  const safeName = name.replace(/["<>]/gu, '_');
  return `<context name="${safeName}">${value.replace(/<\/context\s*>/giu, '<\\/context>')}</context>`;
}
