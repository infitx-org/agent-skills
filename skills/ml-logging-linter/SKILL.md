---
name: ml-logging-linter
description: >-
  Scan JS/TS files for Mojaloop logging rule violations and produce a report with
  fix suggestions. Checks rules covering error handling,
  trace context, log levels, sensitive data, OTel attributes, and semantic patterns.
  Use this skill whenever: auditing JS/TS code for logging quality, reviewing logging
  practices across a Mojaloop service, checking if log statements follow standards,
  preparing a PR that touches logging code, or assessing logging hygiene in any
  Mojaloop/PM4ML codebase. Also activate when the user says "logging lint", "log review",
  "logging audit", "check my logging", "logging violations", "scan for bad logging",
  or asks to find logging anti-patterns in JS/TS files. Works on single files or folders.
argument-hint: <path> [instructions]
allowed-tools: Read, Glob, Grep, Agent
metadata:
  author: "Eugen Klymniuk (geka-evk)"
  version: "1.0"
---

# Mojaloop Logging Linter

Scan JS/TS source files against Mojaloop logging rules and report violations with
fix suggestions. This is an LLM-powered analysis — it uses semantic understanding of the
code rather than AST parsing, so it can catch patterns that mechanical linters miss (like
context-dependent level mismatches or implicit sensitive data exposure). It complements
the ESLint plugin, which handles CI enforcement.

## Rules Source

Read the full rule definitions (descriptions, severity, traceability, good/bad examples)
from `./references/RULES.md` in this skill directory.

If the file does not exist, **stop and tell the user** to run
`scripts/update-rules-md.sh --update` to create it from the eslint plugin source.

If the user provides an alternative RULES.md path in `[instructions]` (e.g., "use rules
from /path/to/custom-rules.md"), use that file instead. If a user-specified path is
unreadable, report the error — do not fall back silently.

## Rules Quick Reference

| Rule | Severity | What it catches |
|------|----------|-----------------|
| `generic-log-message` | Warning | Vague messages ("failed", "processing") without inline context |
| `no-manual-trace-id` | Error | Manual traceId/spanId/traceFlags in log objects (OTel handles this) |
| `catch-and-log-bubble` | Warning | Catch-log-rethrow (pure or wrapped) at `error` level — remove log or downgrade to `warn`. Exception: background jobs without global handler |
| `http-semantics` | Warning | HTTP logs missing OTel attributes per direction; duration in seconds; redact url.query; error.type resolution order |
| `losing-error-stack` | Error | Logging `error.message` instead of the full error object |
| `no-console` | Error | `console.log/error/warn` instead of the standard logger |
| `no-error-context` | Error | `logger.error(err)` without a descriptive context message |
| `no-manual-level-check` | Warning | `if (logger.level === 'debug')` instead of built-in level gating |
| `no-stringified-json` | Warning | `JSON.stringify()` inside log calls (library handles serialization) |
| `non-standard-attributes` | Warning | camelCase attributes instead of OTel dot notation (e.g., `errorMessage`, `durationMs`; prefer `exception.message`, `duration.ms`) |
| `semantic-log-levels` | Warning | Level/keyword mismatch (e.g., "failed" at `info`, "retrying" at `error`) |
| `sensitive-data` | Error | Never-log (passwords, tokens, keys) or mask (accounts -> `****1234`); redact at transport level |
| `sql-semantics` | Warning | SQL logs missing `db.query.text`/`db.system.name`; duration in seconds; never log `db.query.parameter.*` in prod |
| `unnecessary-debug-guard` | Warning | `isDebugEnabled` guarding simple log statements (only needed for expensive computation) |
| `valid-log-levels` | Error | Non-standard levels like `critical`, `warning` (use `fatal`, `warn`) |
| `deprecated-logger` | Error | Uppercase `Logger` usage instead of `logger` (ContextLogger instance) |
| `constant-log-prefix` | Warning | Log prefix not searchable — flag function calls, mutable vars, high-cardinality IDs; accept literals and `const` variables |
| `no-string-interpolation-context` | Warning | Dynamic values in message string instead of structured attributes |
| `kafka-semantics` | Warning | Kafka logs missing OTel messaging attributes (use Kafka wrappers) |
| `no-silent-catch` | Warning | Catch block neither logs nor rethrows — silently swallowed error |
| `no-loop-logging` | Warning | Logging inside tight loops — batch or log aggregates instead |
| `expected-error-level` | Warning | Expected/recoverable errors (ER_DUP_ENTRY, retries) at `error` instead of `warn` |
| `fspiop-header-handling` | Error | FSPIOP-Signature logged raw instead of hashed |
| `sql-no-raw-values` | Error | SQL query text with interpolated values instead of parameterized placeholders |
| `exception-attributes` | Warning | Manual error attrs must use OTel names; `error.type` resolution: err.code -> err.name -> "UnknownError" |
| `no-silent-function` | Warning | Handler/domain/service function with zero log statements — invisible to operators |


## Input Parsing

**Invocation:** `/ml-logging-linter <path> [instructions]`

1. **`<path>`** — resolve to absolute path. Determine if it's a file or directory with TS/JS files
2. **`[instructions]`** — parse for:
   - **Rule filters**: "only errors", "skip no-console", "focus on sensitive-data"
   - **Context hints**: "Kafka consumer handler", "HTTP middleware", "uses custom Logger class"
   - **Scope overrides**: "include test files", "only src/handlers/"

If no `[instructions]` are given, apply all rules defined in RULES.md.


## Workflow

### Single File

Read the rules, read the file, analyze inline (no agents needed). Produce the per-file
report below.

### Folder Mode

1. **Discover files**: Glob `**/*.{js,ts,mjs,mts}` in the target directory.
   Auto-exclude: `node_modules/`, `dist/`, `build/`, `coverage/`, `.git/`.
   Respect `.gitignore` if present. The user can override via instructions.

2. **Read RULES.md** once, before spawning agents.

3. **Adaptive batching** — choose strategy based on file count:

   | Files found | Strategy |
   |-------------|----------|
   | 1 | Analyze inline (same as single file mode) |
   | 2-10 | 1 agent per file — maximum parallelism |
   | 11+ | ~5 files per agent, grouped by directory. Cap at 10 agents max — increase batch size for larger sets |
   | 0 | Report "no matching files found" and exit |

4. **Spawn agents** using the Agent tool. Pass each agent:
   - The RULES.md content (so agents don't each read the file independently)
   - Its assigned file paths
   - The user's `[instructions]`
   - The per-file report format template
   - Instruction to follow ✅ Good patterns from RULES.md for fix suggestions

5. **Collect results** from all agents and produce the aggregate report.

**Agent prompt template:**

```
Analyze these JS/TS files for Mojaloop logging rule violations.

## Rules
{RULES_CONTENT}

## Files
{FILE_PATHS}

## User instructions
{INSTRUCTIONS_OR_NONE}

## Logger Detection
Identify ALL logging statements. Cast a wide net:
- `logger.*`, `log.*`, `Logger.*`, `this.logger.*`, `this.log.*`
- `console.*` (console.log, console.error, console.warn, etc.)
- Any variable imported from a logger module (scan `require`/`import` statements)
- Note: `Logger.*` (uppercase) is itself a `deprecated-logger` violation — always flag it.
If unsure whether something is a logger call, include it in detection. If analysis
reveals it is not a logger, exclude it from the report.

For each file:
1. Read the file content
2. Identify ALL logging statements using the patterns above
3. Check each statement against the applicable rules
4. Group related violations on the same line
5. Generate fix suggestions following the ✅ Good examples in the rules

Return results in the per-file report format.
```


## Analysis Approach

### Logger Detection

Cast a wide net — Mojaloop codebases use various logger wrappers. Look for:
- `logger.*`, `log.*`, `Logger.*`, `this.logger.*`, `this.log.*`
- `console.*` (console.log, console.error, console.warn, etc.)
- Any variable imported from a logger module (look at the file's `require`/`import` statements)
- Common patterns: `const Logger = require('...logger')`, `const { loggerFactory } = require(...)`

Auto-detect the logger variable by scanning imports at the top of the file. If unsure whether
something is a logger call, include it — false positives in detection are better than missed violations.

### Applying Rules

RULES.md is the single source of truth for all rule definitions, severities, and examples.
Check every logging statement against every rule defined there. Do not skip rules or invent
new ones — the skill's purpose is to systematically audit code against that exact rule set.


## Output Format

Keep reports concise. Focus on violations — do NOT list rules with no findings or lines
that passed. The reader wants to see what's wrong and how to fix it, not a catalog of
everything that was checked.

### Per-File Report

```markdown
### `path/to/file.ts`

| Line | Severity | Rule | Issue |
|------|----------|------|-------|
| 42 | Error | losing-error-stack, no-error-context | `logger.error(err.message)` — loses stack, no context message |
| 58 | Warning | catch-and-log-bubble | Catches, logs, and rethrows — will duplicate in caller |

#### Fix: Lines 42, 58

```diff
- logger.error(err.message);
+ logger.error('Bulk transfer lookup failed: ', err);
```

**Summary:** 2 errors, 1 warning across 8 logging statements
```

Key formatting rules:
- Group related violations on the same line into a single table row.
- Combine fix suggestions for violations that share the same pattern — don't repeat
  the same diff block for every instance of the same anti-pattern.
- **Never include `err.message` in fix suggestions** — ContextLogger (Mojaloop's
  standard logger wrapper) auto-formats errors, extracting message, stack, and cause
  chain from the error object. The correct pattern is:
  `logger.<level>('static context: ', err)` — preserve the original log level.
- Fix suggestions in diff blocks should always use lowercase `logger` (ContextLogger),
  never uppercase `Logger`. When quoting existing code in tables or recommendations,
  reproduce the code as-is.
- Fix suggestions must follow the ✅ Good patterns shown in RULES.md.
- **Minimal fixes** — fix only the violated rule, don't restructure surrounding code.
  When multiple violations exist on the same line, produce one diff fixing all of them
  (this is fixing one statement, not "combining"). "Don't combine" means: don't fix
  lines that weren't flagged as violations.
  Exception: when the violation is the *absence* of a log statement (`no-silent-catch`,
  `no-silent-function`), the fix adds the minimum necessary logging.

### Cross-File Aggregate (folder mode)

After all per-file reports, add:

```markdown
## Aggregate Summary

**Files scanned:** 24 | **With violations:** 18
**Violations:** 12 errors, 35 warnings

### Top Violated Rules
| Rule | Count | Severity | Files affected |
|------|-------|----------|----------------|
| no-stringified-json | 12 | Warning | api.ts, db.ts, kafka.ts, ... |
| generic-log-message | 9 | Warning | handler.ts, service.ts, ... |
| losing-error-stack | 7 | Error | transfers.ts, position.ts, ... |

### Recommendations
[Top 3 highest-impact fixes to prioritize, based on frequency and severity]
```

Focus the recommendations on patterns that can be fixed systematically (e.g.,
"All 5 catch-and-log-bubble violations follow the same `Logger.isErrorEnabled && Logger.error(err); throw err` pattern — consider a bulk refactor").


## Evals

Run from the skill directory. Requires Node.js v24+ (native type stripping).

```bash
# Run all evals
node evals/run-evals.ts

# Single eval
node evals/run-evals.ts --eval-id 1

# Skip LLM grading (just produce reports)
node evals/run-evals.ts --skip-grading

# Override the model under test
node evals/run-evals.ts --model sonnet

# Override the grader model (default: haiku)
node evals/run-evals.ts --grader-model sonnet
```

Results are written to `evals/results/` — per-eval `report.md` + `grading.json`, and an aggregate `benchmark.json`.
