# Moral Parliament Quiz - Development Guide

## Status

Production-ready. Refactored from single 816-line file to 25-file modular architecture.

---

## Work in Progress: New Questions & Causes

Replacing the original demo questions/causes with real content. Original configs backed up to `config_archive/`.

### Architecture Changes Made
- Questions can now have different option keys (previously all questions shared the same keys)
- Default credences now derived per-question from options (equal split) instead of global `defaultCredences`
- `generateWorldviews` updated to handle different option keys per dimension
- MaxEV calculation now always winner-take-all (ignores diminishing returns config)
- Added `context` field to questions (renders above instructions on QuestionScreen)
- InfoTooltip now supports markdown (use `[link text](url)` in `info` fields)
- Selection questions use separate instructions (no "Custom Mix" mention)
- Calculation method order configurable via `features.json` → `calculations.order`
- Renamed "Merged Favorites" to "Proportional Allocation" in copy.json

### Questions Implemented (6 of 7)
All questions are `type: "selection"` (pick one, no sliders).

| # | ID | Topic | Pattern | Multiplier range |
|---|-----|-------|---------|------------------|
| 1 | `disability` | Human disability vs saving lives | `appliesWhen: preventsDisability` | 0 - 0.086 |
| 2 | `income` | Income vs saving lives | `appliesWhen: increasesIncome` | 0 - 0.0172 |
| 3 | `chicken` | Chicken vs human welfare | `appliesWhen: helpsChickens` | 0 - 0.0172 |
| 4 | `shrimp` | Shrimp vs human welfare | `appliesWhen: helpsShrimp` | 0 - 0.0172 |
| 5 | `timeframes` | Short vs. long-term effects | `appliesTo: timeframe` | per-timeframe (0-1) |
| 6 | `xrisk` | Existential risk priority | `appliesWhen: isNonXRisk` | 0 - 1 |

### Causes Implemented (6)
| Cause | Key properties | scaleFactor |
|-------|----------------|-------------|
| Blindness Prevention | `preventsDisability`, `isNonXRisk`, `timeframe: short` | 1 |
| Basic Income | `increasesIncome`, `isNonXRisk`, `timeframe: short` | 1 |
| Chicken Welfare | `helpsChickens`, `isNonXRisk`, `timeframe: short` | 100 |
| Shrimp Welfare | `helpsShrimp`, `isNonXRisk`, `timeframe: short` | 1000 |
| AI Safety Research | `timeframe: long`, x-risk | 1 |
| Pandemic Prevention | `timeframe: short`, x-risk | 1 |

### Config Settings
- `diminishingReturns: "extreme"` (power = 0.1)
- All causes have `points: 100`

### Pending/Notes
- Question spec mentions chicken/shrimp weights should depend on Q1 answer (not implemented - using fixed 0.0172 default)
- **Q6 (risk) - NOT IMPLEMENTED**: Removed pending manager feedback. Requires architectural changes - causes need probability distributions and calculation methodology changes (upside skepticism = truncate 99th percentile, loss aversion = 3x weight on negative outcomes). See `question.txt` for full spec.
- `scaleFactor` on animal causes represents relative population scale (not currently used in calculations)

### WorldviewDimension Patterns
Two patterns are supported for applying multipliers:

**Pattern 1: `appliesWhen` (boolean flag)**
```json
"worldviewDimension": {
  "appliesWhen": "helpsChickens",
  "applyAs": "multiplier",
  "options": { "equal": 1, "10x": 0.1, "100x": 0.01 }
}
```
Multiplier applies only to causes where `cause.helpsChickens === true`.

**Pattern 2: `appliesTo` (property value lookup)**
```json
"worldviewDimension": {
  "appliesTo": "timeframe",
  "applyAs": "multiplier",
  "options": {
    "equalAll": { "short": 1, "medium": 1, "long": 1 },
    "prioritizeNearer": { "short": 1, "medium": 0.5, "long": 0.2 }
  }
}
```
Looks up `cause.timeframe` (e.g., "short") and uses that key to find the specific multiplier.

---

## Development Notes

### Dev Server

**Two options depending on what you're working on:**

| Command | URL | Use when |
|---------|-----|----------|
| `npm run dev` | `localhost:5173` | Frontend-only work (faster) |
| `netlify dev` | `localhost:8888` | Testing share URLs or other backend features |

The vite server (`npm run dev`) is faster but can't reach the serverless functions. Use `netlify dev` when testing anything that hits `/api/*` endpoints.

### Testing
- `npm test` - run tests in watch mode
- `npm run test:run` - single run
- Pre-commit hook runs linting + tests

### Design Decisions
All visual/UX design decisions are handled by the UX team, not implementation. Manu and Claude implement features with placeholder styles that will be updated when design specs arrive.

---

## Hosting & Backend

### Hosting
- **Frontend**: GitHub Pages at `https://rethinkpriorities.github.io/quiz-demo/`
- **Share API**: AWS Lambda Function URL (deployed via SAM CLI)
- **Local dev**: Netlify dev (`netlify dev`) or Vite (`npm run dev`)

Config: `netlify.toml` (local dev), `lambda/template.yaml` (AWS).

### Database (Turso)
SQLite database hosted on Turso for share URL persistence.

| Environment | Database | Config |
|-------------|----------|--------|
| Local dev | `dev.db` (SQLite file) | `.env` → `file:dev.db` |
| Production | Turso cloud | Lambda env vars (set via SAM deploy) |

**Local setup:**
```bash
python3 scripts/init-dev-db.py   # Create local dev.db with schema
netlify dev                       # Run frontend + functions at localhost:8888
```

**Credentials:**
- Production credentials stored in 1Password
- `VITE_API_URL` set in GitHub repo secrets (points Lambda Function URL to frontend build)
- Turso credentials passed to Lambda via `--parameter-overrides` on deploy
- Local `.env` file (gitignored) points to local SQLite

### Serverless Functions
Two copies of the share function (kept in sync):
- `netlify/functions/share.js` — Local dev with `netlify dev`
- `lambda/share/index.mjs` — Production (AWS Lambda)

### Deploying the Lambda

The Lambda auto-deploy GitHub Action is disabled — deploy manually from CLI:

```bash
cd lambda/share && npm ci && cd ..
sam build
sam deploy \
  --stack-name quiz-demo-share \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --parameter-overrides \
    TursoDatabaseUrl="<turso-url>" \
    TursoAuthToken="<turso-token>" \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset
```

**If SAM deploy fails** with `EarlyValidation::PropertyValidation` (CloudFormation validation hook issue), deploy the code directly:

```bash
cd lambda/.aws-sam/build/ShareFunction
zip -r /tmp/lambda-share.zip .
aws lambda update-function-code \
  --function-name quiz-demo-share \
  --zip-file fileb:///tmp/lambda-share.zip
```

Requires AWS CLI configured with credentials (`aws configure`). Turso credentials are already set on the existing Lambda from the initial SAM deploy.

### Database Migrations
Migrations are idempotent SQL files in `migrations/`. Uses `CREATE TABLE IF NOT EXISTS` pattern.

**Workflow:**
1. Write migration in `migrations/NNN_description.sql`
2. Test locally: `sqlite3 dev.db < migrations/NNN_description.sql`
3. Commit and deploy
4. Run on prod: `turso db shell donor-compass < migrations/NNN_description.sql`

**Current migrations:**
- `001_initial_schema.sql` - Creates `shares` table

---

## Feature Flag System

**File:** `config/features.json`

- Features defined as true/false flags
- Import in components: `import features from '../config/features.json'`
- Missing flags should be handled gracefully with defaults

### Development Workflow
1. Implement feature with flag in `config/features.json` (default: `false`)
2. Test with flag enabled
3. Create prototype snapshot: `scripts/snapshot.sh` (UI features only)
4. Document in Completed Features section

---

## Completed Features

Summary of implemented features. See `docs/CLAUDE-ARCHIVE.md` for detailed implementation notes.

| Feature | Flag | Description |
|---------|------|-------------|
| Reset Button | `ui.resetButton` | "Start Over" button on results screen with confirmation |
| Slider Lock | `ui.sliderLock` | Lock a slider in place while others adjust proportionally |
| Calculation Debugger | `developer.calculationDebugger` | Runtime modification of calculation parameters |
| Question Config | N/A | Questions defined in `config/questions.json` |
| Context API | N/A | Centralized state via `src/context/QuizContext.jsx` |
| Calculation Display | `calculations.show*`, `calculations.sideBySideComparison` | Control which calculation cards appear and comparison mode |
| Question Types | `ui.questionTypes` | Four presentation modes: default, selection, credence, preset. **Defaults to ON.** |
| Intermission Type | N/A (requires `ui.questionTypes`) | Pause screen showing partial results + contextual copy. Excluded from progress count. |
| Share Results | `ui.shareResults` | Share quiz results via URL using backend API. |
| Session Persistence | N/A | Quiz progress persists across page reloads via sessionStorage. Conflict modal when share URL + existing session. |
| Diminishing Returns | `causes.json` → `diminishingReturns` | Spread allocations instead of winner-take-all. Modes: `none`, `sqrt` (default), `extreme`. |
| Donor Compass Branding | N/A | Visual revamp: Raleway font, teal gradient background, RP logo, white CTA buttons, consistent card styling. |
| Calculation Select | `ui.calculationSelect` | Dropdown selectors on result cards to switch between calculation types. |
| Moral Marketplace | `ui.moralMarketplace` | Combines multiple worldviews into unified allocation. Currently disabled. |
| Preset Credences | `type: "preset"` | Two-card layout with preset options and read-only sliders. Animated transitions. |
| Multiple Worldviews | `ui.multipleWorldviews` | Save quiz as named worldview, retake, compare. WorldviewHub UI. Currently disabled. |
| Disclaimer Page | `ui.disclaimerPage` | Initial disclaimer screen before welcome page. |
| Info Tooltips | `ui.questionInfo`, `ui.answerInfo` | Markdown-enabled info tooltips on questions and answer options. |
| Feedback Card | `ui.feedbackCard` | Feedback request card on results screen. |

### Key Architecture Notes
- **State management**: React Context in `src/context/QuizContext.jsx`
- **Questions**: `config/questions.json` with `worldviewDimension` for calculations
- **Causes**: `config/causes.json` with points, colors, boolean flags, and `diminishingReturns` setting
- **Validation**: Runs on dev startup (`validateCauses.js`, `validateQuestions.js`)
- **Disabling questions**: Prefix any question type with `_` (e.g., `"type": "_intermission"`) to exclude it from the quiz

### Question Types System
When `ui.questionTypes` is enabled, questions can have different presentation modes:

| Type | Behavior | Config |
|------|----------|--------|
| `default` | Mode toggle available (Pick One / Custom Mix) | Omit `type` or set `"type": "default"` |
| `selection` | Pick one option only, no sliders | `"type": "selection"` |
| `credence` | Sliders only, no discrete choice | `"type": "credence"` |
| `preset` | Two-card layout with preset options + read-only sliders | `"type": "preset"` with `presets` array |
| `intermission` | Pause with partial results + copy | `"type": "intermission"` with `title` and `body` |

Colors defined in `src/constants/config.js` as `QUESTION_TYPE_COLORS` (placeholder: same colors for all types).

**Preset behavior:**
- Two-card layout: preset options on left, sliders on right
- Sliders become read-only when a preset is selected
- Click "Custom" to enable manual slider adjustment
- Auto-selects "Custom" when user starts dragging sliders
- Animated transitions (300ms) between presets

**Intermission behavior:**
- Displays `ResultCard` components showing current calculation results
- Shows configurable `title` and `body` text
- Does not count toward progress bar or "Question X of Y"
- No credences stored (no edit panel on results screen)
- When `ui.questionTypes` is disabled, intermissions are filtered out entirely

---

## Planned Features

### 1. Stale URL Recovery (Share Results Layer 2)
**Flag:** `ui.shareResults` (extends existing feature)

Graceful handling when a shared URL references a quiz configuration that has changed.

**Current behavior (Layer 1):**
- If URL is valid and all questions/options match: restore and show results
- If URL is invalid or config changed: show error toast, start fresh quiz

**Layer 2 behavior:**
- If some questions missing or options changed: show dialog explaining quiz has changed
- User clicks through quiz to answer only the missing/changed questions
- Pre-populate matching questions from URL data
- Answers to removed questions are ignored

**Implementation notes:**
- Detect which questions exist in URL but not in config (removed)
- Detect which questions exist in config but not in URL (new)
- Detect which options changed for existing questions
- Dialog component explaining the situation
- Modified quiz flow: skip pre-populated questions, show only new/changed
- Navigation logic to handle partial completion

**Dependencies:**
- Requires `ui.shareResults` Layer 1 (completed)

---

### 2. Export Results as PDF
**Flag:** `ui.exportPDF`

Download quiz results as a PDF document. Hybrid approach: visual screenshot of results + text footer with data summary and shareable link.

**Behavior:**
- Results screen shows "Download PDF" button
- Click generates and downloads PDF
- PDF contains:
  1. Screenshot of results screen (preserves exact visual appearance)
  2. Text footer with plain text summary of results
  3. Clickable shareable URL (same as Share Results feature)

**Technical Approach:**
- Dynamic import of libraries (only loaded when user clicks download)
- Use html2canvas to capture results screen as image
- Use jsPDF to create PDF, add image, then add text footer
- Footer text is native PDF text (selectable, accessible)
- URL is clickable link via jsPDF `.link()` method

```js
const handleDownload = async () => {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf')
  ]);
  // capture, generate, download
};
```

**Footer Content:**
- Quiz title and completion date
- Summary of calculation results (text form)
- Shareable URL that repopulates quiz with these answers

**Dependencies:**
- `html2canvas` (~40kb gzipped)
- `jspdf` (~90kb gzipped)
- `lz-string` (shared with Share Results feature)

**Relationship to Share Results:**
- Reuses URL generation logic from Share Results feature
- If Share Results is also enabled, same URL appears in both places
- Can be implemented independently, but shares `lz-string` encoding utilities

---

### 3. Results-Only Share Mode
**Flag:** `ui.shareResultsOnly` (extends `ui.shareResults`)

Share quiz results without exposing the underlying quiz answers. Recipients see only the final results, not the credences that produced them.

**Behavior:**
- Results screen shows additional "Share Results Only" button (alongside full share)
- Generated URL contains calculation results but blocks answer repopulation
- Recipients landing on this URL go directly to results view
- No access to edit panels or individual question answers

**Data Format:**
- Builds on existing lz-string compression from `ui.shareResults`
- Adds `resultsOnly: true` flag in the encoded data
- Stores calculation results directly instead of (or in addition to) credences
- When `resultsOnly` flag is detected, app renders results in read-only mode

**URL Structure:**
```
https://.../#results=compressed_data
```
Same hash format as feature #5, but data payload includes the `resultsOnly` marker.

**Loading from URL:**
- On page load, decompress data and check for `resultsOnly` flag
- If `resultsOnly: true`: render results screen in read-only mode
- Skip any "edit your answers" functionality
- Hide navigation back to quiz questions

**Graceful Failure:**
- If quiz config has changed significantly (calculation methods, cause definitions), results may be invalid
- Detect mismatches by comparing stored calculation IDs against current config
- On mismatch: show friendly message ("These results were generated with an older version of the quiz")
- Optionally display partial results if some calculations still match
- Never crash or show broken UI

**Dependencies:**
- `lz-string` (shared with features #5 and #6)
- Requires `ui.shareResults` infrastructure

**Relationship to Share Results (#5):**
- Shares URL encoding/decoding utilities
- Both features can coexist (two share buttons on results screen)
- Results-only mode is a subset: less data exposed, simpler recipient experience

---

### 4. AI Results Explanation
**Flag:** `ui.aiExplanation`

Show an "Explain Results" button that generates a personalized explanation of why the user got their results, powered by Claude API.

**Behavior:**
- Results screen shows "Explain Results" button
- Click sends quiz data to Vercel serverless function
- Backend calls Claude API with quiz context + user's answers/results
- Returns short paragraph explanations for each voting method
- Displays explanations inline on results screen

**Example Output:**
> "You value animals highly, and scale matters. There are many times more animals than humans, therefore animal welfare wins a lot of these voting methods."

**Architecture:**
```
[Frontend] → [Vercel Serverless Function] → [Claude API]
     ↑                                            ↓
     └──────────── Response ──────────────────────┘
```

**Request Payload:**
- User's credences per question
- Calculation results (winners, scores)
- Question metadata (worldview dimensions)
- Cause definitions

**Backend Prompt:**
- System prompt explaining quiz mechanics and calculation methods
- How worldview dimensions map to cause scoring
- Instructions to generate concise, personalized explanations
- One paragraph per voting method explaining the "why"

**Serverless Function:**
- Located in `/api/explain.js` (Vercel convention)
- Validates request payload
- Constructs prompt with quiz context + user data
- Calls Claude API (claude-3-haiku or claude-3-5-sonnet)
- Returns structured response with per-method explanations

**Frontend State:**
- Loading state while waiting for API response
- Error handling with user-friendly message
- Cache response in session (don't re-fetch on re-render)

**Dependencies:**
- `@anthropic-ai/sdk` (backend only)
- Vercel deployment for serverless functions
- `ANTHROPIC_API_KEY` environment variable

**Security Considerations:**
- API key stored in Vercel environment variables (never exposed to frontend)
- Rate limiting on serverless function
- Input validation to prevent prompt injection

---

## References

| File | Purpose |
|------|---------|
| `config/features.json` | Feature flags |
| `config/questions.json` | Question definitions + worldview dimensions |
| `config/causes.json` | Cause definitions (points, colors, flags) + `diminishingReturns` setting |
| `config/copy.json` | UI copy/text content |
| `src/context/QuizContext.jsx` | React Context state management |
| `src/utils/calculations.js` | Calculation functions |
| `src/utils/shareUrl.js` | URL encoding/decoding for Share Results |
| `src/utils/session.js` | Session persistence utilities (sessionStorage) |
| `src/constants/config.js` | Constants: colors, input modes, question types |
| `netlify.toml` | Netlify deployment config (build, redirects, functions) |
| `netlify/functions/share.js` | Share URL serverless function |
| `migrations/` | Database migrations (idempotent SQL) |
| `scripts/snapshot.sh` | Prototype builder |
| `scripts/init-dev-db.py` | Initialize local dev database |
| `docs/CLAUDE-ARCHIVE.md` | Detailed implementation notes for completed features |
| `example/` | Standalone calculation code for Moral Marketplace feature |
