// https://docs.expo.dev/guides/using-eslint/
const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

// Modules are used through their public index, never by reaching into their files.
const publicIndexOnly = [
  {
    group: ['@/features/*/*'],
    message: "Import from the feature's public index (e.g. '@/features/history').",
  },
  {
    group: ['@/scanner/*', '!@/scanner/testing'],
    message:
      "Import from '@/scanner' (or '@/scanner/testing' for fixtures). See src/scanner/README.md.",
  },
];

module.exports = defineConfig([
  globalIgnores(['dist/*', 'coverage/*', 'src/scanner/api/schema.gen.ts']),
  expoConfig,
  prettierConfig,
  {
    rules: {
      'no-restricted-imports': ['error', { patterns: publicIndexOnly }],
    },
  },
  {
    // The scanner is meant to be embeddable in other apps and websites, so it
    // must not depend on anything specific to this one. See src/scanner/README.md.
    files: ['src/scanner/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'expo-router',
              message:
                'The scanner does not navigate. Take a callback or prop and let the route decide.',
            },
          ],
          patterns: [
            {
              group: [
                '@/features',
                '@/features/*',
                '@/config/*',
                '@/hooks/*',
                '@/app/*',
                '@/scanner',
              ],
              message:
                'The scanner may import only its own files (relative), @/theme and @/components/ui.',
            },
          ],
        },
      ],
    },
  },
]);
