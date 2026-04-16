# Contributing

Thanks for contributing! This project has automated linting, formatting, and testing that run on every commit. If you skip the setup below, your commits will pass locally but fail in CI on your pull request.

## One-time setup

### 1. Install Node.js

Use **Node 20** (what CI runs). Any recent Node will probably work, but 20 is guaranteed.

- macOS: `brew install node@20`
- Or via [nvm](https://github.com/nvm-sh/nvm): `nvm install 20 && nvm use 20`

Verify:

```bash
node --version   # should print v20.x.x (or similar)
```

### 2. Install project dependencies

From the repo root:

```bash
npm install
```

**Do not pass `--ignore-scripts`.** That flag skips the step that installs the git hooks. If you already ran it that way, just run `npm install` again normally.

### 3. Verify the git hook is active

```bash
git config core.hooksPath
# Expected output:  .husky
```

If that prints nothing, re-run `npm install`. If it still doesn't work:

```bash
npx husky init
```

## What happens on `git commit`

A pre-commit hook (managed by [husky](https://typicode.github.io/husky/)) runs automatically:

1. **`lint-staged`** — on staged files only:
   - `*.js`, `*.jsx` → `eslint --fix` + `prettier --write`
   - `*.css` → `prettier --write`
2. **`npm run test:run`** — full test suite.

Files auto-fixed by step 1 are re-staged automatically. If lint can't auto-fix or any test fails, the commit is blocked.

**Do not use `git commit --no-verify` to bypass this.** If a check is failing, fix the underlying issue.

## What CI checks

On every PR, GitHub Actions runs (see `.github/workflows/ci.yml`):

| Step | Command |
|------|---------|
| Validate JSON configs | `npm run validate` |
| Lint | `npm run lint` |
| Check formatting | `npm run format:check` |
| Run tests | `npm run test:run` |
| Build | `npm run build` |

To run all of these locally before pushing:

```bash
npm run validate && npm run lint && npm run format:check && npm run test:run && npm run build
```

If that passes, CI will pass.

## Common issues

### "My commit was blocked by lint errors"

```bash
npm run lint:fix     # auto-fix what ESLint can
git add -u           # re-stage
git commit           # try again
```

If lint still complains, open the file ESLint points at and fix the remaining issues manually.

### "My commit was blocked by formatting errors"

```bash
npm run format       # rewrite files to Prettier style
git add -u
git commit
```

### "Tests failed and I don't know why"

```bash
npm test             # interactive watch mode — easier to read
```

Fix the code or the test. Don't delete tests to make them pass — ask a maintainer if you're stuck.

### "CI fails but my local commit worked"

Run the full CI check locally:

```bash
npm run validate && npm run lint && npm run format:check && npm run test:run && npm run build
```

The hook only runs lint and tests on staged files. CI checks everything. If formatting or validation drift creeps in from unstaged files, CI catches it.

## Dev workflow reference

| Command | What it does |
|---------|--------------|
| `npm run dev` | Frontend dev server at `localhost:5173` (fastest, no serverless functions) |
| `netlify dev` | Frontend + serverless functions at `localhost:8888` (use for share/donate testing) |
| `npm test` | Tests in watch mode |
| `npm run test:run` | Tests once and exit |
| `npm run lint` | ESLint (read-only) |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run format` | Prettier (write) |
| `npm run format:check` | Prettier (read-only) |
| `npm run validate` | Validate JSON config files |
| `npm run build` | Production build |

## Project conventions

See [`CLAUDE.md`](./CLAUDE.md) for:

- Architecture overview
- Feature flag system (`config/features.json`)
- Question/cause config (`config/questions.json`, `config/causes.json`)
- Serverless function layout (Lambda + Netlify dev mirrors)
- Database migrations

## Questions?

Open an issue or ping a maintainer. Happy contributing!
