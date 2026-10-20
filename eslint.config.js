import { join } from 'node:path';
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

// Sidecar feature modules (CONTEXT D37): kernel/ is shared and never imports modules/; a module imports
// kernel/, its own files and other modules' index.ts only; container.ts/main.ts compose kernel + module
// entry points; domain/ folders stay pure (domain, port types and zod validation only; tests may use kernel fakes).
const sidecarSrc = 'apps/sidecar/src';

const sidecarElements = [
  { type: 'kernel-domain', pattern: `${sidecarSrc}/kernel/domain` },
  { type: 'kernel-contract', pattern: `${sidecarSrc}/kernel/ports` },
  { type: 'kernel-contract', pattern: `${sidecarSrc}/kernel/validation` },
  { type: 'kernel', pattern: `${sidecarSrc}/kernel` },
  { type: 'module-domain', pattern: `${sidecarSrc}/modules/*/domain`, capture: ['module'] },
  { type: 'module', pattern: `${sidecarSrc}/modules/*`, capture: ['module'] },
  { type: 'composition-root', pattern: sidecarSrc },
];

const kernelTypes = ['kernel', 'kernel-domain', 'kernel-contract'];
const kernelTargets = kernelTypes.map((type) => ({ element: { type } }));
const moduleEntryPoint = { element: { type: 'module', fileInternalPath: 'index.ts' } };
const sameModule = (type) => ({ element: { type, captured: { module: '{{ from.captured.module }}' } } });
const pureTargets = [{ element: { type: 'kernel-domain' } }, { element: { type: 'kernel-contract' } }];

const boundaryPolicies = [
  { allow: { to: { module: { origin: 'external' } } } },
  { allow: { to: { module: { origin: 'core' } } } },
  { allow: { dependency: { relationship: { to: 'internal' } } } },
  { from: { element: { type: 'kernel' } }, allow: { to: kernelTargets } },
  { from: { element: { type: 'kernel-contract' } }, allow: { to: pureTargets } },
  { from: { element: { type: 'kernel-domain' } }, allow: { to: pureTargets } },
  {
    from: { element: { type: 'module' } },
    allow: { to: [...kernelTargets, sameModule('module'), sameModule('module-domain'), moduleEntryPoint] },
  },
  {
    from: { element: { type: 'module-domain' } },
    allow: { to: [...pureTargets, sameModule('module-domain')] },
  },
  {
    from: { element: { types: ['kernel-domain', 'kernel-contract', 'module-domain'] }, file: { categories: 'test' } },
    allow: { to: kernelTargets },
  },
  {
    from: { element: { type: 'composition-root' } },
    allow: { to: [...kernelTargets, moduleEntryPoint, { element: { type: 'composition-root' } }] },
  },
];

export default [
  {
    ignores: [
      '**/dist/**',
      '**/dist-sidecar/**',
      '**/target/**',
      '**/node_modules/**',
      '.npm-cache/**',
      '.stryker-tmp/**',
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
    files: ['e2e/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.mocha, browser: 'readonly', window: 'readonly' },
    },
  },
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: 'Use ConfirmDialog for user confirmation.' },
        { name: 'alert', message: 'Use an in-app message for user alerts.' },
        { name: 'prompt', message: 'Use an in-app form for user input.' },
      ],
      'no-restricted-syntax': [
        'error',
        ...restrictedSyntax,
        {
          selector:
            'Literal[value=/\\b(?:bg|text|border|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b/]',
          message: 'Use semantic theme color tokens instead of Tailwind palette colors.',
        },
      ],
      'no-restricted-properties': [
        'error',
        ...restrictedProperties,
        ...['confirm', 'alert', 'prompt'].map((property) => ({
          object: 'window',
          property,
          message: 'Use an accessible in-app UI instead of a native browser dialog.',
        })),
      ],
    },
  },
  {
    files: typescriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: {
          defaultProject: 'apps/sidecar/tsconfig.json',
          allowDefaultProject: [
            'scripts/lint-fixtures/*.ts',
            'scripts/lint-fixtures/*.tsx',
            'vitest.config.ts',
            'vitest.integration.config.ts',
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
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...restrictedSyntax,
        {
          selector:
            'Literal[value=/\\b(?:bg|text|border|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b/]',
          message: 'Use semantic theme color tokens instead of Tailwind palette colors.',
        },
      ],
    },
  },
  {
    files: ['apps/sidecar/src/**/*.{ts,tsx}'],
    plugins: {
      boundaries,
    },
    settings: {
      'boundaries/elements': sidecarElements,
      'boundaries/files': [{ category: 'test', pattern: '**/*.test.ts' }],
      'import/resolver': {
        [join(import.meta.dirname, 'scripts/lint/ts-resolver.cjs')]: {},
        node: {},
      },
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
