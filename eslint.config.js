import eslint from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typescriptFiles = ['**/*.{ts,tsx,mts,cts}'];

const typescriptConfigs = [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked].map(
  (config) => ({ ...config, files: typescriptFiles }),
);

const restrictedSyntax = [
  { selector: 'TSEnumDeclaration', message: 'Use as-const object + union (CONVENTIONS §2).' },
  { selector: "TSModuleDeclaration[kind!='global']", message: 'Namespaces are forbidden (CONVENTIONS §2).' },
  { selector: 'ExportDefaultDeclaration', message: 'Default exports are forbidden (CONVENTIONS §2).' },
  { selector: 'TSParameterProperty', message: 'Parameter properties are forbidden (CONVENTIONS §2).' },
  {
    selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
    message: 'Raw HTML injection is forbidden (CONVENTIONS §7).',
  },
  {
    selector: "AssignmentExpression[left.type='MemberExpression'][left.property.name='innerHTML']",
    message: 'Assigning innerHTML is forbidden (CONVENTIONS §7).',
  },
  {
    selector: "AssignmentExpression[left.type='MemberExpression'][left.property.value='innerHTML']",
    message: 'Assigning innerHTML is forbidden (CONVENTIONS §7).',
  },
  { selector: "CallExpression[callee.name='eval']", message: 'eval is forbidden.' },
  { selector: "NewExpression[callee.name='Function']", message: 'new Function is forbidden.' },
  {
    selector: "Property[key.name='shell'][value.value=true]",
    message: 'shell: true is forbidden (CONVENTIONS §7).',
  },
];

const restrictedProperties = [
  { property: 'eval', message: 'eval is forbidden.' },
  { property: 'innerHTML', message: 'innerHTML is forbidden.' },
];

const withoutDefaultExportRestriction = restrictedSyntax.filter(
  ({ selector }) => selector !== 'ExportDefaultDeclaration',
);

const sidecarLayers = [
  'rpc',
  'services',
  'domain',
  'providers',
  'infra',
  'validation',
  'scheduler',
  'prompts',
  'ports',
];

const allowedTargets = {
  rpc: ['services', 'validation'],
  services: ['domain', 'ports'],
  providers: ['domain', 'ports'],
  infra: ['domain', 'ports'],
  validation: ['domain'],
  scheduler: ['services'],
};

const boundaryPolicies = [
  { allow: { to: { module: { origin: 'external' } } } },
  { allow: { to: { module: { origin: 'core' } } } },
  { allow: { dependency: { relationship: { to: 'internal' } } } },
  ...Object.entries(allowedTargets).map(([from, targets]) => ({
    from: { element: { type: from } },
    allow: { to: targets.map((type) => ({ element: { type } })) },
  })),
  ...sidecarLayers.map((from) => {
    const disallowedTargets = sidecarLayers.filter((type) => {
      if (from === 'domain') {
        return true;
      }

      return type !== from && !allowedTargets[from]?.includes(type);
    });

    return {
      from: { element: { type: from } },
      disallow: {
        to: disallowedTargets.map((type) => ({ element: { type } })),
      },
    };
  }),
];

export default [
  {
    ignores: [
      '**/dist/**',
      '**/target/**',
      '**/node_modules/**',
      '.npm-cache/**',
      'apps/desktop/src-tauri/**',
      'scripts/lint-fixtures/**',
      'scripts/design/**',
      'scripts/dev/**',
    ],
  },
  eslint.configs.recommended,
  ...typescriptConfigs,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: typescriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'scripts/lint-fixtures/*.ts',
            'scripts/lint-fixtures/*.tsx',
            'vitest.config.ts',
            'apps/desktop/vitest.config.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-undef': 'off',
      'no-restricted-properties': ['error', ...restrictedProperties],
      'no-restricted-syntax': ['error', ...restrictedSyntax],
    },
  },
  {
    files: ['apps/sidecar/src/**/*.{ts,tsx}'],
    plugins: {
      boundaries,
    },
    settings: {
      'boundaries/elements': sidecarLayers.map((type) => ({
        type,
        pattern: `apps/sidecar/src/${type}/**`,
      })),
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message: 'Sidecar dependency violates CONVENTIONS §3.2.',
          policies: boundaryPolicies,
        },
      ],
    },
  },
  {
    ...reactHooks.configs.flat.recommended,
    files: ['apps/desktop/src/**/*.tsx'],
  },
  {
    files: ['**/*.config.{js,ts,mjs}', '**/vite.config.ts', 'eslint.config.js'],
    rules: {
      'no-restricted-syntax': ['error', ...withoutDefaultExportRestriction],
    },
  },
  {
    files: ['src/types/schemas.ts'],
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/consistent-indexed-object-style': 'off',
    },
  },
  prettier,
];
