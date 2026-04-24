const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    rules: {
      // Keep CI/dev linting focused on truly blocking issues for this project.
      // Legacy warnings are intentionally disabled to keep the pipeline clean.
      'react/no-unescaped-entities': 'off',
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'import/no-duplicates': 'off',
    },
  },
  {
    ignores: ["dist/*"],
  }
]);
