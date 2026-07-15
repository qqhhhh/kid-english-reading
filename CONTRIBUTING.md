# Contributing

Thank you for contributing.

1. Create a focused branch.
2. Do not commit API keys, student data, recordings, PDFs, generated page images,
   databases, logs, or third-party model files.
3. Use synthetic content in tests and screenshots.
4. Run:

   \`\`\`text
   npx tsc --noEmit
   npm test
   npm run build
   git diff --check
   \`\`\`

5. Explain behavior changes and data migrations in the pull request.

By contributing, you agree that your contribution is licensed under the MIT
License.
