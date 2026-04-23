# Contributing

Thanks for contributing! This project has automated linting, formatting, and testing that run on every commit. If you skip the setup below, your commits will pass locally but fail in CI on your pull request.

## Using an AI coding assistant

If you're using AI to help you contribute, there are two paths. We recommend **[Claude Code](https://claude.com/claude-code)** running on your own machine — the rest of this file assumes that setup. If you're already comfortable with Claude Cowork, that works too, with some caveats (see below).

### Why Claude Code (local) is the better path

- The pre-commit hook runs automatically — you can't accidentally ship code that fails lint or tests.
- The agent can run the dev server (`npm run dev`) and see UI changes in a browser as it makes them.
- The agent can test serverless functions locally (`netlify dev`) for features like share URLs or the donation form.
- Faster feedback: the agent sees test failures, stack traces, and browser state directly, instead of waiting on CI.

Install Claude Code, connect it to this repo, clone the repo locally, then follow the [One-time setup](#one-time-setup) below.

### If you're using Claude Cowork

**First, connect Cowork to GitHub.** Cowork can be connected to a GitHub repo so it creates branches and opens PRs directly against this repo. Do that instead of copy/pasting code out of the chat into the GitHub web UI. With the connection set up, the agent can also run commands against the real repo state — without it, you lose the ability to run lint/tests at all and your PRs will only be checked once CI runs.

Cowork runs in Anthropic's cloud and commits via the GitHub API, so **the pre-commit hook does not run** — husky only fires on a local `git commit`, and Cowork never uses that path. By default, CI on your PR is the only check.

To catch issues before opening the PR, ask the agent to run this inside its sandbox after it's finished making changes:

```bash
npm install
npm run validate && npm run lint && npm run format:check && npm run test:run && npm run build
```

This is the same set of checks CI runs — if it passes in the sandbox, it will pass in CI. If anything fails, ask the agent to fix it and re-run before opening the PR.

**Limitations vs. Claude Code:** Cowork can't open a browser, so it can't verify UI changes visually — a reviewer will need to pull the branch to eyeball visual work. It also can't run `netlify dev`, so share URLs and the donation form can't be tested end-to-end before the PR.

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
