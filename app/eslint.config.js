// https://docs.expo.dev/guides/using-eslint/
const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  globalIgnores(['dist/*', 'coverage/*', 'src/api/schema.gen.ts']),
  expoConfig,
  prettierConfig,
  {
    rules: {
      // Screens in src/app/ stay thin: they compose features, never reach into
      // another feature's internals. Import from a feature's index instead.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*/*'],
              message: "Import from the feature's public index (e.g. '@/features/verdict').",
            },
          ],
        },
      ],
    },
  },
]);
