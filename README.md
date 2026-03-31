# Donor Compass (Moral Parliament Quiz)

An interactive tool to help you allocate resources across different causes based on your moral credences—the probabilities you assign to different ethical perspectives.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![React](https://img.shields.io/badge/react-18.3.1-blue.svg)
![Vite](https://img.shields.io/badge/vite-6.0.5-purple.svg)

## 📖 Overview

**Donor Compass** is a Rethink Priorities tool that helps you navigate moral uncertainty by:

- Asking about your values and preferences on key ethical dimensions
- Calculating which charitable funds best match those preferences
- Allowing real-time adjustment and exploration of how different inputs affect recommendations

The tool has two modes:

### Simple Quiz (Default)

A streamlined 4-question quiz (~2 minutes) where you pick presets that map directly to a single worldview, producing a bar chart of fund scores. Questions cover:

1. **Animal Moral Weights**: How much do you value animal welfare relative to human welfare?
2. **Time Discounting**: How much do you discount effects further in the future?
3. **Extinction Risk**: How much should extinction risk discount non-x-risk projects?
4. **Risk Attitude**: What is your attitude toward uncertainty in cost-effectiveness estimates?

Each question offers preset options plus expandable custom inputs. From the results screen, you can jump to Advanced Mode with your answers pre-populated.

### Advanced Mode (Table Mode)

A power-user interface for configuring multiple worldviews with full control over moral weights, discount factors, risk profiles, and extinction risk. Supports multiple voting methods (credence-weighted parliament, MEC, Borda count, and more) with configurable multi-stage budget allocation.

Access via the "Go to Advanced Mode" button on the simple quiz results screen, or directly at `#table`.

---

## 🚀 Quick Start

### Prerequisites

- Node.js 16+ and npm

### Installation

```bash
# Clone the repository (or navigate to your project directory)
cd quiz-demo

# Install dependencies
npm install
```

### Development

```bash
# Start dev server (with hot module replacement)
npm run dev

# Open http://localhost:5173/ in your browser
```

### Backend Development

The share API runs as an AWS Lambda in production and a Netlify function locally. Both use a Turso (SQLite) database.

```bash
# Initialize local dev database (first time only)
python3 scripts/init-dev-db.py

# Run full stack locally (frontend + serverless functions)
netlify dev

# Open http://localhost:8888/ in your browser
```

Local development uses a SQLite file (`dev.db`) instead of the production Turso database. The `.env` file (gitignored) configures this automatically.

### Deploying the Lambda

The share API Lambda is deployed manually (the GitHub Action is disabled):

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

If SAM deploy fails with a CloudFormation validation error, deploy code directly:

```bash
cd lambda/.aws-sam/build/ShareFunction
zip -r /tmp/lambda-share.zip .
aws lambda update-function-code \
  --function-name quiz-demo-share \
  --zip-file fileb:///tmp/lambda-share.zip
```

Requires AWS CLI credentials (`aws configure`) and SAM CLI.

### Code Quality

```bash
# Run ESLint to check for issues
npm run lint

# Auto-fix ESLint issues
npm run lint:fix

# Format code with Prettier
npm run format

# Check if code is formatted
npm run format:check
```

Pre-commit hooks automatically run linting and formatting on staged files.

### Database Migrations

Database schema changes use idempotent SQL files in `migrations/`:

```bash
# Run migration locally
sqlite3 dev.db < migrations/001_initial_schema.sql

# Run migration on production (after deploy)
turso db shell donor-compass < migrations/001_initial_schema.sql
```

Migrations use `CREATE TABLE IF NOT EXISTS` so they can be safely re-run.

### Production Build

```bash
# Build for production
npm run build

# Preview production build locally
npm run preview
```

### Prototyping

Create snapshots to compare different versions:

```bash
# Create a named snapshot
npm run snapshot a "Baseline version with original UI"

# Commit and push
git add prototypes/ && git commit -m "Add prototype a"
git push && git push --tags
```

View prototypes at `/prototypes/` on the deployed site.

To modify a previous prototype:
```bash
git checkout prototype-a-v1      # Go to tagged commit
git checkout -b prototype-a-fix  # Create branch for changes
# ... make changes ...
npm run snapshot a               # Rebuilds, tags as v2
```

---

## 📁 Project Structure

```
quiz-demo/
├── config/                         # JSON configuration files
│   ├── causes.json                 # Cause definitions (points, colors, flags)
│   ├── copy.json                   # UI copy/text content
│   ├── features.json               # Feature flags for toggling functionality
│   ├── questions.json              # Question definitions and worldview dimensions (legacy quiz)
│   ├── simpleQuizConfig.json       # Simple quiz question definitions + preset options
│   └── worldviewPresets.json       # Worldview presets + default worldview template
│
├── src/
│   ├── main.jsx                    # React entry point + config validation
│   ├── App.jsx                     # Main app wrapper
│   │
│   ├── components/
│   │   ├── MoralParliamentQuiz.jsx     # Main quiz orchestrator
│   │   ├── DisclaimerScreen.jsx        # Initial disclaimer (optional)
│   │   ├── WelcomeScreen.jsx           # Landing page
│   │   ├── WorldviewHub.jsx            # Worldview management hub (advanced)
│   │   ├── QuestionScreen.jsx          # Reusable question template
│   │   ├── PresetQuestion.jsx          # Preset-style question layout
│   │   ├── RatioQuestion.jsx           # Ratio-style question (advanced)
│   │   ├── IntermissionScreen.jsx      # Mid-quiz pause with partial results
│   │   ├── ResultsScreen.jsx           # Results display
│   │   ├── MoralMarketplaceScreen.jsx  # Combined worldview analysis (advanced)
│   │   ├── CalculationDebugger.jsx     # Developer tool for testing calculations
│   │   │
│   │   ├── simple/                       # Simple quiz components
│   │   │   ├── SimpleWelcomeScreen.jsx   # Welcome screen for simple quiz
│   │   │   ├── SimpleQuizScreen.jsx      # Question screen with preset buttons
│   │   │   ├── SimpleMoreOptions.jsx     # Expanded options + manual inputs
│   │   │   └── SimpleResultsScreen.jsx   # Bar chart results
│   │   │
│   │   ├── ui/                         # Reusable UI components
│   │   │   ├── OptionButton.jsx        # Quick selection button
│   │   │   ├── CredenceSlider.jsx      # Full-size slider for questions
│   │   │   ├── CompactSlider.jsx       # Compact slider for results
│   │   │   ├── CompactSelection.jsx    # Compact selection buttons for results
│   │   │   ├── ModeToggle.jsx          # Options/Sliders mode switcher
│   │   │   ├── CauseBar.jsx            # Horizontal bar chart
│   │   │   ├── ResultCard.jsx          # Calculation result card with cause bars
│   │   │   ├── EditPanel.jsx           # Collapsible credence editor
│   │   │   ├── InfoTooltip.jsx         # Info icons with markdown tooltips
│   │   │   ├── ShareButton.jsx         # Share results button
│   │   │   ├── SessionConflictModal.jsx # Session/share conflict resolution
│   │   │   ├── WorldviewSlotModal.jsx  # Edit worldview modal (advanced)
│   │   │   └── WorldviewSwitchModal.jsx # Switch worldview modal (advanced)
│   │   │
│   │   └── layout/                     # Layout components
│   │       ├── Header.jsx              # Page header
│   │       └── ProgressBar.jsx         # Progress indicator
│   │
│   ├── context/                    # React Context for state management
│   │   ├── QuizContext.jsx         # Legacy quiz state provider and hooks
│   │   ├── useQuiz.js              # Custom hook for consuming quiz context
│   │   ├── SimpleQuizContext.jsx   # Simple quiz state (useReducer + session persistence)
│   │   └── useSimpleQuiz.js        # Custom hook for simple quiz context
│   │
│   ├── utils/                      # Pure utility functions
│   │   ├── calculations.js         # All calculation logic
│   │   ├── projectScoring.js       # Shared scoring engine (calculateProject, adjustForExtinctionRisk)
│   │   ├── simpleQuizScoring.js    # Simple quiz: assembleWorldview, computeSimpleScores
│   │   ├── shareUrl.js             # URL encoding/decoding for sharing results
│   │   ├── validateCauses.js       # Validates causes.json on startup
│   │   └── validateQuestions.js    # Validates questions.json on startup
│   │
│   ├── constants/                  # Static configuration
│   │   └── config.js               # Colors, input modes, question types
│   │
│   └── styles/                     # Styling
│       ├── variables.css           # CSS custom properties (design system)
│       ├── global.css              # Global styles and utilities
│       └── components/             # Component-specific CSS modules
│           ├── CauseBar.module.css
│           ├── Debugger.module.css
│           ├── EditPanel.module.css
│           ├── Intermission.module.css
│           ├── ModeToggle.module.css
│           ├── OptionButton.module.css
│           ├── QuestionScreen.module.css
│           ├── Results.module.css
│           ├── Slider.module.css
│           └── WelcomeScreen.module.css
│
├── index.html                      # HTML entry point
├── vite.config.js                  # Vite configuration
├── vitest.config.js                # Test configuration
├── netlify.toml                    # Netlify deployment config
├── package.json                    # Dependencies and scripts
│
├── netlify/functions/              # Serverless backend
│   └── share.js                    # Share URL API (create/retrieve)
│
├── migrations/                     # Database migrations (idempotent SQL)
│   └── 001_initial_schema.sql      # Creates shares table
│
├── scripts/
│   ├── snapshot.sh                 # Prototype snapshot script
│   ├── init-dev-db.py              # Initialize local dev database
│   └── validate-config.js          # Config validation for CI
│
├── prototypes/                     # Committed prototype builds
│   └── index.html                  # Prototype listing page
├── legacy/                         # Python reference implementations for parity testing
│   ├── generate_fixtures.py        # Generates JSON test fixtures from Python code
│   ├── requirements.txt            # Python dependencies (numpy)
│   ├── refactored/
│   │   └── donor_compass.py        # credenceWeighted, myFavoriteTheory, mec + sub-calculations
│   └── expanded/
│       ├── calculation.py          # borda, splitCycle, lexicographicMaximin, nashBargaining, met, msa
│       └── multi_stage_aggregation.py  # MSA theory types and MEC aggregation
│
├── docs/                           # Documentation
│   ├── CLAUDE-ARCHIVE.md           # Detailed implementation notes for completed features
│   ├── REFACTORING_NOTES.md        # Bug fixes and architectural decisions
│   ├── COMPONENT_BOUNDARIES.md     # Component responsibility documentation
│   └── legacy-calculation-differences.md  # Python vs JS algorithmic differences
└── CLAUDE.md                       # Development guide and feature tracking
```

---

## 🧮 How It Works

### Calculation Methods

The quiz supports multiple question types: selection (pick one), credence (sliders), preset (predefined distributions), and default (toggle between pick one and sliders). With deterministic selections, calculations are optimized to O(1) for worldview generation.

#### Diminishing Returns

By default, the quiz uses **diminishing returns** (sqrt mode) which models that the first dollar spent on a cause does more good than the hundredth. This causes allocations to spread across causes rather than going 100% to a single winner.

Configure in `config/causes.json`:
- `"none"` - Linear utility, winner-take-all
- `"sqrt"` - Moderate spreading (default)
- `"extreme"` - Near-equal distribution

#### 1. Max Expected Value (MaxEV)
Calculates the expected value for each cause across all 81 worldview combinations. With diminishing returns, allocations spread proportionally to squared EVs. Without diminishing returns, allocates 100% to the cause with highest EV.

For each cause:
```
EV = Σ (P(animal_view) × P(future_view) × P(scale_view) × P(certainty_view) ×
      value(cause, animal_mult, future_mult, scale_exp, certainty_mult))
```

Where multipliers/exponents are:
- Animal/Future equal weight: 1.0, 10× less: 0.1, 100× less: 0.01
- Scale equal: 0 (no effect), 10×: 0.5 (sqrt), 100×: 1.0 (full scale)
- Certainty equal: 1.0, 10× discount: 0.1, 100× discount: 0.01

#### 2. Variance Voting (Moral Parliament)
Each worldview combination votes for its preferred cause(s), weighted by credence. If multiple causes are tied for a worldview, the vote splits equally.

```
For each worldview (81 total):
  - Find cause(s) with max value in this worldview
  - Assign vote_weight / num_tied_causes to each tied cause
```

Final percentages represent the proportion of votes each cause received.

#### 3. Merged Favorites
Each worldview allocates its probability share of the budget. With diminishing returns, each worldview spreads its share across causes proportionally. Without diminishing returns, each worldview allocates entirely to its favorite.

```
For each worldview:
  - Worldview gets (probability × 100) percent of budget
  - With diminishing returns: spread across causes analytically
  - Without: allocate entirely to favorite cause(s)
```

#### 4. Maximin
Finds the allocation that maximizes the minimum utility any worldview receives. An egalitarian approach that ensures no worldview is left too unhappy.

```
- Test 16 candidate allocations (100% to one, 50/50 splits, etc.)
- For each allocation, find minimum utility across all worldviews
- Choose allocation with highest minimum
```

### Auto-Balancing Sliders

The sliders feature sophisticated UX with ratio preservation and smooth animations:

**During Drag:**
1. Slider being dragged moves with unlimited precision (`step="any"`)
2. On drag start, a snapshot of all credences is captured
3. Other sliders maintain their exact original ratio throughout the drag
4. All calculations use decimal values for smooth, continuous adjustment
5. Display percentages are rounded to integers for clean presentation

**On Release:**
1. Final values are rounded to integers
2. Non-dragged sliders animate smoothly to final positions (0.4s ease-out)
3. All values guaranteed to sum to exactly 100%

**Proportional Distribution:**
- Changed slider gets new value (clamped 0-100)
- Other sliders adjust proportionally based on original ratios from snapshot
- If others are all 0, remaining value distributes evenly

See `src/utils/calculations.js` for implementation details (`adjustCredences()` and `roundCredences()`).

---

## 🛠️ Technology Stack

- **React 18.3.1** - UI framework
- **Vite 6.0.5** - Build tool and dev server
- **Netlify** - Hosting and serverless functions
- **Turso** - SQLite database (libSQL)
- **lucide-react 0.462.0** - Icons
- **CSS Modules** - Component-scoped styling
- **CSS Custom Properties** - Design system (colors, spacing, typography)
- **ESLint** - Code linting with React best practices
- **Prettier** - Code formatting
- **Husky + lint-staged** - Pre-commit hooks for code quality

### Fonts
- **Raleway** - Primary font for headings and body text (Rethink Priorities brand)
- **Cormorant Garamond** - Decorative italic for emphasis text ("Giving Go?")

---

## 🎨 Design System

The app uses Rethink Priorities branding with a comprehensive design system defined in `src/styles/variables.css`:

- **Colors**: Teal gradient palette (`#0C435F` → `#1E7D95`), white CTAs, 40+ semantic variables
- **Typography**: Raleway (primary), Cormorant Garamond (decorative), 13 size scales, 5 weights
- **Spacing**: 13-level spacing scale (0 to 4rem)
- **Border Radius**: 7 variants (4px to full circle)
- **Transitions**: Smooth animations throughout
- **Background**: Teal gradient image with varied bright spots (`bg-dark.png`)

Global utility classes in `src/styles/global.css` provide common patterns like flex layouts, button styles, and card containers.

---

## 🧪 Testing

### Automated Tests

```bash
# Run tests in watch mode
npm test

# Single test run
npm run test:run
```

**Test coverage (~176 tests across 10 files):**
- `calculations.test.js` - Calculations, Monte Carlo sampling, appliesTo pattern (35 tests)
- `ResultsScreen.test.jsx` - Reset button functionality (5 tests)
- `CredenceSlider.test.jsx` - Slider lock feature (8 tests)
- `QuestionScreen.test.jsx` - Question types mode toggle (6 tests)
- `EditPanel.test.jsx` - Selection vs slider rendering (8 tests)
- `QuizContext.intermission.test.jsx` - Intermission progress/feature flag (8 tests)
- `moralMarketplace.test.js` - Moral marketplace worldview expansion and voting (14 tests)
- `legacy-parity.test.js` - Legacy Python parity: sub-calculations + 9 voting methods (92 tests)

### Legacy Parity Tests

The `legacy-parity.test.js` suite verifies that all 9 voting methods in `marcusCalculation.js` produce identical results to the original Python implementations. Tests consume pre-generated JSON fixtures — no Python needed at CI time.

**Covered methods:** credenceWeighted, myFavoriteTheory, mec, borda, splitCycle, lexicographicMaximin, nashBargaining, met, msa

**Regenerating fixtures** (only needed if Python reference code changes):

```bash
# Set up Python venv (first time only)
python3 -m venv legacy/.venv
legacy/.venv/bin/pip install -r legacy/requirements.txt

# Generate fixtures
legacy/.venv/bin/python legacy/generate_fixtures.py
```

See `docs/legacy-calculation-differences.md` for documented algorithmic differences between Python and JS implementations.

### Manual Testing Areas
The dev server runs at `http://localhost:5173/` with hot module replacement (or `http://localhost:8888/` with `netlify dev` for full stack).

Test the following flows:

**Simple Quiz (default):**
- Welcome → 4 questions → results bar chart
- "More options" expands additional presets + custom inputs per question
- Custom inputs apply immediately (slider, number fields, dropdown)
- "Go to Advanced Mode" → table mode loads with quiz worldview pre-populated
- "Start Over" → returns to welcome (with confirmation)
- Session persistence: reload mid-quiz restores state
- `#table` URL → table mode works directly (no regression)

**Legacy Quiz** (set `ui.simpleQuiz: false`):
- All user flows (welcome → questions → results)
- Option selection and slider modes
- Auto-balancing behavior (sliders always sum to 100%)
- Real-time recalculation in results screen
- Reset functionality (individual and "Reset All")

**General:**
- Visual polish and responsive design
- Browser console should show zero errors

---

## 📝 Development Notes

### State Management

**Simple Quiz** state is managed via `src/context/SimpleQuizContext.jsx` — a lightweight `useReducer` with session persistence. State shape:

```js
{
  currentStep: 'disclaimer' | 'welcome' | 0..3 | 'results',
  selections: { questionId: optionId },     // preset selections
  manualOverrides: { questionId: value },    // custom input overrides (take priority)
}
```

**Legacy Quiz** state is managed via React Context in `src/context/QuizContext.jsx`:

```js
{
  currentStep: 'welcome' | 'disclaimer' | questionId | 'results' | 'marketplace',
  questions: {
    [questionId]: {
      credences: { optionKey: number, ... },
      originalCredences: null | {...},
      inputMode: 'options' | 'sliders',
      lockedKey: null | optionKey
    }
  },
  expandedPanel: null | questionId,
  debugConfig: null | {...},
  // Multiple worldviews (when enabled)
  worldviewIds: [...],
  worldviewNames: {...},
  currentWorldviewId: string
}
```

Components access state via the `QuizContext`:
```js
import { useContext } from 'react';
import { QuizContext } from '../context/QuizContext';

const { currentStep, stateMap, goForward } = useContext(QuizContext);
```

### Adding New Questions

Questions are defined in `config/questions.json`. To add a new question:

1. Add the question object to `config/questions.json`:
   ```json
   {
     "id": "newQuestion",
     "type": "selection",           // "default", "selection", "credence", or "preset"
     "worldviewDimension": {
       // Pattern 1: Boolean flag - applies multiplier when cause has flag
       "appliesWhen": "causeFlag",
       "applyAs": "multiplier",
       "options": { "equal": 1, "10x": 0.1, "100x": 0.01 }

       // Pattern 2: Property lookup - different multipliers per property value
       // "appliesTo": "timeframe",
       // "options": {
       //   "equalAll": { "short": 1, "medium": 1, "long": 1 },
       //   "shortOnly": { "short": 1, "medium": 0, "long": 0 }
       // }
     },
     "categoryLabel": "Category",
     "icon": "heart",
     "previewText": "Short description",
     "heading": "Full question text?",
     "instructionsOptions": "Instructions for option mode...",
     "instructionsSliders": "Instructions for slider mode...",
     "editPanelTitle": "Panel Title",
     "options": [
       { "key": "equal", "label": "Option A", "description": "...", "panelLabel": "A", "panelShort": "A" },
       { "key": "10x", "label": "Option B", "description": "...", "panelLabel": "B", "panelShort": "B" },
       { "key": "100x", "label": "Option C", "description": "...", "panelLabel": "C", "panelShort": "C" }
     ]
   }
   ```

2. If the question affects a new cause flag, add it to `config/causes.json`

3. The app automatically:
   - Generates the question screen
   - Updates progress calculation
   - Adds edit panel to results screen
   - Includes dimension in worldview calculations

4. Validation runs on startup (dev mode) and will catch config errors

### Code Quality

- **Pure Functions**: All calculations are pure (no side effects)
- **Component Separation**: Each component has single responsibility
- **CSS Modules**: Scoped styles prevent conflicts
- **JSDoc Comments**: Utility functions documented with types
- **ESLint**: Enforces React best practices and catches common mistakes
- **Prettier**: Consistent code formatting across the project
- **Pre-commit Hooks**: Automatic linting and formatting before commits

---

## 🐛 Known Issues & Future Work

### Planned Improvements

- [x] Refine slider recalculation UX during drag operations (completed with ratio preservation and smooth animations)
- [x] Add component tests with React Testing Library (~176 tests across 10 test files)
- [ ] Add TypeScript for type safety
- [x] Add unit tests for calculation functions (diminishing returns)
- [ ] Improve accessibility (ARIA labels, keyboard navigation)
- [ ] Add error boundaries
- [x] Session persistence and share URLs
- [x] Multiple question types (selection, credence, preset)
- [x] Info tooltips with markdown support

See **docs/REFACTORING_NOTES.md** for details on bug fixes and architectural decisions.

---

## 🤝 Contributing

This project was refactored from a single-file prototype (816 lines) into a modular architecture. The original source is preserved in git history (commit dd5499b).

When contributing:
1. Follow existing component patterns
2. Use CSS variables for colors/spacing
3. Keep functions pure and testable
4. Update documentation for significant changes

---

## 📄 License

MIT License - feel free to use and modify as needed.

---

## 🙏 Acknowledgments

- Calculation methods inspired by moral uncertainty frameworks
- Built with modern React best practices
- Designed for clarity and maintainability

---

**Questions or Issues?**
See the testing checklist and refactoring notes for detailed documentation.
