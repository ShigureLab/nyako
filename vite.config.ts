import { defineConfig } from 'vite-plus'

export default defineConfig({
  fmt: {
    printWidth: 100,
    tabWidth: 2,
    singleQuote: true,
    trailingComma: 'es5',
    semi: false,
    arrowParens: 'always',
    ignorePatterns: ['dist/**', 'node_modules/**', 'coverage/**', 'pnpm-lock.yaml'],
    overrides: [
      {
        files: ['*.md'],
        options: {
          tabWidth: 3,
        },
      },
      {
        files: ['*.json5'],
        options: {
          singleQuote: false,
        },
      },
    ],
  },
  staged: {
    '*.{ts,js,mjs,cjs,json,json5,md}': 'vp check --fix',
  },
})
