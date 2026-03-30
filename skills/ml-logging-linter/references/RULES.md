# ESLint Rules Documentation

This documentation describes the rules included in `eslint-plugin-mojaloop-logging`, their traceability to the Mojaloop Standard, and examples of compliant vs. non-compliant code.

## Table of Contents

- [generic-log-message](#generic-log-message)
- [no-manual-trace-id](#no-manual-trace-id)
- [catch-and-log-bubble](#catch-and-log-bubble)
- [http-semantics](#http-semantics)
- [losing-error-stack](#losing-error-stack)
- [no-console](#no-console)
- [no-error-context](#no-error-context)
- [no-manual-level-check](#no-manual-level-check)
- [no-stringified-json](#no-stringified-json)
- [non-standard-attributes](#non-standard-attributes)
- [semantic-log-levels](#semantic-log-levels)
- [sensitive-data](#sensitive-data)
- [sql-semantics](#sql-semantics)
- [unnecessary-debug-guard](#unnecessary-debug-guard)
- [valid-log-levels](#valid-log-levels)
- [deprecated-logger](#deprecated-logger)
- [constant-log-prefix](#constant-log-prefix)
- [no-string-interpolation-context](#no-string-interpolation-context)
- [kafka-semantics](#kafka-semantics)
- [no-silent-catch](#no-silent-catch)
- [no-loop-logging](#no-loop-logging)
- [expected-error-level](#expected-error-level)
- [fspiop-header-handling](#fspiop-header-handling)
- [sql-no-raw-values](#sql-no-raw-values)
- [exception-attributes](#exception-attributes)
- [no-silent-function](#no-silent-function)

---

### generic-log-message

**Description:** Warns when log messages are too generic (e.g., "failed", "processing", "success") without inline context.

**Severity:** `Warning`

**Standard Traceability:**
- `standard/data_model.md`: "The message (Body) should be human-readable and self-explanatory... Include specific values inline... Examples of poor messages: 'Validation failed', 'Processing transfer'."

**Examples:**

❌ **Bad**
```javascript
logger.info("Processing started", { transferId });
logger.error("Validation failed", { error });
```

✅ **Good**
```javascript
logger.info('processing transfer', { transferId });
logger.error(`validation failed for transfer ${transferId}: `, error);
```

---

### no-manual-trace-id

**Description:** Disallows manual injection of `traceId`, `spanId`, or `traceFlags` into log objects, as these are handled automatically by OpenTelemetry instrumentation.

**Severity:** `Error`

**Standard Traceability:**
- `standard/trace_context.md`: "You should **NOT** manually add traceId/spanId to log calls. These are automatically injected."

**Examples:**

❌ **Bad**
```javascript
logger.info("Message", { traceId: req.headers['fspiop-trace-id'] });
```

✅ **Good**
```javascript
// Trace context is injected automatically by the logger infrastructure
logger.info("Message");
```

---

### catch-and-log-bubble

**Description:** Detects the "Catch and Log" anti-pattern where an error is caught, logged at `error` level, and re-thrown (directly or wrapped). This causes duplicate error-level logs up the stack. Two variants:
- **Pure rethrow** (`throw err`): remove the log entirely — boundary handler will log it
- **Wrap and rethrow** (`throw reformatFSPIOPError(err)` or `throw new Error('...', { cause: err })`): either remove the log (cause chain is preserved) or downgrade to `warn` for intermediate-layer visibility
- **Exception**: Background jobs and async event handlers without a global error handler may log internally — this is not catch-and-log-bubble

**Severity:** `Warning`

**Standard Traceability:**
- `standard/best_practices.md`: "Do **NOT** catch an error just to log it and throw it again... 'Errors captured in more than one place (often three times)'."

**Examples:**

❌ **Bad**
```javascript
// Pure rethrow — log is redundant, boundary handler will log it
try {
  await doSomething();
} catch (err) {
  logger.error(err);
  throw err;
}

// Wrap and rethrow — error level at intermediate layer pollutes error aggregations
try {
  await doSomething();
} catch (err) {
  logger.error('operation failed: ', err);
  throw ErrorHandler.Factory.reformatFSPIOPError(err);
}
```

✅ **Good**
```javascript
// Pure rethrow — wrap with context, don't log
try {
  await doSomething();
} catch (err) {
  throw new AppError("Context", { cause: err });
}
// Log only at the edge/global handler

// Wrap and rethrow — no intermediate log (cause chain preserved)
try {
  await doSomething();
} catch (err) {
  throw ErrorHandler.Factory.reformatFSPIOPError(err);
}

// Wrap and rethrow — warn for intermediate visibility (not error)
try {
  await doSomething();
} catch (err) {
  logger.warn('operation failed, wrapping: ', err);
  throw ErrorHandler.Factory.reformatFSPIOPError(err);
}
```

---

### http-semantics

**Description:** Enforces that HTTP-related logs (mentioning "request" or "response") include OTel HTTP attributes. Required attributes differ by direction:
- **Incoming**: `http.request.method`, `url.path`, `url.scheme`, `request.id`, `http.server.request.duration`
- **Outgoing**: `http.request.method`, `url.full`, `server.address`, `server.port`
- **Conditionally required** (both): `error.type` (if error occurred), `http.response.status_code` (if response sent)
- **Recommended** (outgoing): `service.peer.name` (logical remote service name)

Duration must be in **seconds** (not milliseconds). `url.full` and `url.query` must redact sensitive query parameters. `error.type` resolution order: `err.code` → `err.name` → `"UnknownError"`.

Client code should use HTTP wrappers (Hapi plugins, HTTP client wrappers) that handle request/response logging with proper OTel attributes — don't add HTTP attributes manually in handler code.

**Severity:** `Warning`

**Standard Traceability:**
- `standard/best_practices.md` & `standard/data_model.md`: "Use OTel's standard attribute names... HTTP: `http.request.method`, `url.path`..."
- `standard/scenarios/http_requests.md`: direction-specific Required attributes

**Examples:**

❌ **Bad**
```javascript
// Missing OTel attributes entirely
logger.info("Incoming HTTP Request");
// Incomplete — missing direction-specific attributes
logger.info("Incoming HTTP Request", { "http.request.method": "POST" });
```

✅ **Good**
```javascript
// Incoming request — wrapper/plugin handles these attributes
logger.info("Incoming HTTP Request", {
  "http.request.method": "POST",
  "url.path": "/transfers",
  "url.scheme": "https",
  "request.id": reqId,
  "http.server.request.duration": duration
});
// Outgoing request — wrapper handles these attributes
logger.info("Outgoing HTTP Request", {
  "http.request.method": "GET",
  "url.full": "https://peer-dfsp:3000/parties/MSISDN/123",
  "server.address": "peer-dfsp",
  "server.port": 3000
});
```

---

### losing-error-stack

**Description:** Prevents logging only `error.message`. The full error object must be passed to ensure the stack trace is captured.

**Severity:** `Error`

**Standard Traceability:**
- `standard/best_practices.md`: "**Requirement:** 'Verify that Errors are logged with Error Code, Error Stack defined'."

**Examples:**

❌ **Bad**
```javascript
logger.error(`Failed: ${error.message}`);
```

✅ **Good**
```javascript
logger.error('operation failed: ', error);
```

---

### no-console

**Description:** Disallows the use of `console.log`, `console.error`, etc. in favor of the standard logger.

**Severity:** `Error` (except in tests/scripts)

**Standard Traceability:**
- `standard/best_practices.md`: "Do **not** use `console.log`... Delegate collection... to external tools."

**Examples:**

❌ **Bad**
```javascript
console.log("Server started");
```

✅ **Good**
```javascript
logger.info("Server started");
```

---

### no-error-context

**Description:** Ensures error logs include context. Raw errors should either be passed alongside a message or wrapped in a context object.

**Severity:** `Error`

**Standard Traceability:**
- `standard/best_practices.md`: "Missing Context in Message... Message doesn't explain what happened."

**Examples:**

❌ **Bad**
```javascript
logger.error(error); // Just the error, no message/context
```

✅ **Good**
```javascript
logger.error('transfer failed: ', error);
```

---

### no-manual-level-check

**Description:** Finds usages of `if (logger.level === 'debug')` or similar manual checks. `loggerFactory` handles this efficiently.

**Severity:** `Warning`

**Standard Traceability:**
- `standard/best_practices.md`: "Use `loggerFactory` from contextLogger - It checks `is<Level>Enabled` internally."

**Examples:**

❌ **Bad**
```javascript
if (config.logLevel === 'debug') {
  logger.debug('...');
}
```

✅ **Good**
```javascript
// Just log it. The factory handles the check.
logger.debug('...');
```

---

### no-stringified-json

**Description:** Detects `JSON.stringify()` calls inside log routines. Logging libraries handle serialization; stringifying manually double-encodes and hurts performance.

**Severity:** `Warning`

**Standard Traceability:**
- `standard/best_practices.md`: "Avoid JSON.stringify - Let the logging library handle serialization."

**Examples:**

❌ **Bad**
```javascript
logger.info(`Data: ${JSON.stringify(data)}`);
```

✅ **Good**
```javascript
logger.info('Data received', { data });
```

---

### non-standard-attributes

**Description:** Enforces OpenTelemetry naming conventions (dot notation) for attributes like `exception.message`, `exception.stacktrace`, `duration.ms`.

**Severity:** `Warning`

**Standard Traceability:**
- `standard/data_model.md`: "Use OTel's standard attribute names... `exception.message`, `exception.stacktrace`, `duration.ms`."

**Examples:**

❌ **Bad**
```javascript
logger.info("Done", { duration: 500, errorMsg: err.message });
```

✅ **Good**
```javascript
logger.info("Done", { "http.server.request.duration": 0.5, "url.path": "/transfers" });
```

---

### semantic-log-levels

**Description:** Uses heuristics to check if the wrong log level is used based on keywords (e.g., "failed" in an INFO log, or "retrying" in an ERROR log). Mojaloop-specific heuristics:
- **Expected DB errors** (ER_DUP_ENTRY, constraint violations) should be `warn`, not `error`
- **verbose vs debug**: verbose = flow events (entry/exit), debug = data contents
- **info = business events only**, not internal implementation details

**Severity:** `Warning`

**Standard Traceability:**
- `standard/log_levels.md`: Defines when to use FATAL, ERROR, WARN, INFO, DEBUG.

**Examples:**

❌ **Bad**
```javascript
logger.info("Transaction failed"); // Failure should be Error
logger.error("Retrying connection..."); // Recoverable retry should be Warn
logger.error("Duplicate entry: ", err); // ER_DUP_ENTRY is expected, should be Warn
logger.debug("entering validateTransfer"); // Flow event should be Verbose
logger.info("cache miss, fetching from DB"); // Internal detail, not a business event
```

✅ **Good**
```javascript
logger.error("Transaction failed");
logger.warn("Retrying connection...");
logger.warn("Duplicate entry (idempotent write): ", err);
logger.verbose("entering validateTransfer");
logger.debug("cache miss, fetching from DB");
logger.info("transfer committed successfully: ", { transferId });
```

---

### sensitive-data

**Description:** Partial matches for sensitive terms in log arguments: password, token, secret, ssn, msisdn, key, apiKey, privateKey, bankAccount, accountNumber, bearer, authorization, pin, otp, creditCard, cardNumber. Two handling levels:
- **Never log**: passwords, tokens, secrets, keys, PINs, OTPs, authorization headers
- **Mask** (if needed): bank accounts → `****1234`, MSISDNs → `****5678`, card numbers → `****1234`

Redaction should be handled at the transport/config level, not per call site.

**Severity:** `Error`

**Standard Traceability:**
- `standard/security.md`: "Strictly avoid logging sensitive information."

**Examples:**

❌ **Bad**
```javascript
logger.info("User login", { password: user.password });
logger.info("Transfer", { accountNumber: "1234567890" });
```

✅ **Good**
```javascript
logger.info("User login", { userId: user.id });
// If account reference is needed, mask it
logger.info("Transfer", { accountNumber: "****7890" });
```

---

### sql-semantics

**Description:** Enforces that SQL-related logs (mentioning "sql" or "query") include OTel database attributes. Required: `db.query.text` and `db.system.name`. Recommended: `db.operation.name`, `db.namespace`, `db.collection.name`. Duration must be in **seconds** (not milliseconds). Client code should use a centralized DB wrapper (e.g., `createMysqlQueryBuilder`) that handles query logging with proper OTel attributes — don't add SQL attributes manually in application code. Never log `db.query.parameter.*` in production — mask PII even at TRACE level.

**Severity:** `Warning`

**Standard Traceability:**
- `standard/best_practices.md`: "Database: `db.system.name`, `db.query.text`..."
- `standard/scenarios/sql_queries.md`: Required and recommended attribute sets

**Examples:**

❌ **Bad**
```javascript
logger.debug("Executing SQL Query");
// Missing db.system.name
logger.debug("Executing SQL Query", { "db.query.text": "SELECT * FROM users" });
// Duration in milliseconds (should be seconds)
logger.debug("SQL query completed", { "db.client.operation.duration": 150 });
```

✅ **Good**
```javascript
// DB wrapper handles logging with proper OTel attributes
logger.debug("Executing SQL Query", {
  "db.query.text": "SELECT * FROM users WHERE id = ?",
  "db.system.name": "mysql",
  "db.operation.name": "SELECT",
  "db.namespace": "central_ledger",
  "db.collection.name": "users",
  "db.client.operation.duration": 0.15
});
```

---

### unnecessary-debug-guard

**Description:** Flags `isDebugEnabled()` checks protecting simple log statements. This check should only be used for expensive computations.

**Severity:** `Warning`

**Standard Traceability:**
- `standard/best_practices.md`: "Use `isDebugEnabled()` only for expensive computation - Guard... only when arguments ... require expensive work."

**Examples:**

❌ **Bad**
```javascript
if (logger.isDebugEnabled()) {
  logger.debug("Hello world");
}
```

✅ **Good**
```javascript
logger.debug("Hello world");

// OR (Valid use case)
if (logger.isDebugEnabled()) {
  logger.debug("Report", { report: buildExpensiveReport() });
}
```

---

### valid-log-levels

**Description:** Enforces standard Mojaloop log levels (fatal, error, warn, info, debug, trace, verbose, perf, silly, audit).

**Severity:** `Error`

**Standard Traceability:**
- `standard/log_levels.md`: "Mojaloop log levels map to OpenTelemetry SeverityNumber ranges..."

**Examples:**

❌ **Bad**
```javascript
logger.critical("Crash!"); // 'critical' is not a standard level
logger.warning("Warning"); // 'warning' should be 'warn'
```

✅ **Good**
```javascript
logger.fatal("Crash!");
logger.warn("Warning");
```

---

### deprecated-logger

**Description:** Flags usage of the legacy uppercase `Logger` variable instead of `logger` (ContextLogger instance). The uppercase `Logger` is the old naming convention that often comes with unnecessary `isErrorEnabled` guards and lacks `.child()` usage. All code should use a lowercase `logger` — the ContextLogger instance that supports `.child()`, async context propagation, and structured logging. There should be only one `loggerFactory` call per project (in a shared logger module); all other files import and reuse that instance. If a file imports both `Logger` and `logger`, the dual-import is the root issue.

**Severity:** `Error`

**Standard Traceability:**
- `standard/best_practices.md`: "Use `loggerFactory` from contextLogger — It checks `is<Level>Enabled` internally before calling Winston, so log arguments are only serialized when the level is active."

**Examples:**

❌ **Bad**
```javascript
const Logger = require('../../shared/logger').logger
Logger.isErrorEnabled && Logger.error(err)
```

✅ **Good** (when the project already has a shared logger module)
```javascript
const { logger } = require('../../shared/logger')
logger.error('operation failed: ', err)
```

✅ **Good** (shared logger module — one per project, calls loggerFactory once)
```javascript
// e.g. src/shared/logger.js or src/lib/logger.js or src/logger.js
const { loggerFactory } = require('@mojaloop/central-services-logger/src/contextLogger')

const logger = loggerFactory('MY-SERVICE')

module.exports = {
  logger
}
```

---

### constant-log-prefix

**Description:** Log messages must start with a searchable prefix — either a string literal or a `const` variable with a known, bounded value. The goal is that operators can find the log line in aggregators (Kibana, Grafana Loki) by searching for a predictable string. Function calls with unpredictable output, mutable variables, and high-cardinality values (IDs, timestamps) must not be the prefix — put them after it.

**Severity:** `Warning`

**Standard Traceability:**
- `standard/data_model.md`: "The message (Body) should be human-readable and self-explanatory..."

**What counts as searchable:**
- Literal string: `'transfer processing failed: '`
- `const` variable: `const logPrefix = 'domain::prepare'` — known value, reusable
- `const` with bounded conditional: `` const logPrefix = `domain::${isTransfer ? 'transfer' : 'fxTransfer'}::prepare` `` — finite set of values

**What is NOT searchable (flag these):**
- Function calls: `Util.breadcrumb(location)` — unpredictable, stateful
- Mutable variables: `let prefix = ...` — could change between log statements
- High-cardinality values as prefix: `` `${transferId} — processing` `` — millions of values

**Examples:**

❌ **Bad**
```javascript
// Function call as prefix — unpredictable output
logger.error(`${Util.breadcrumb(location)}::${err.message}`)
logger.error(Util.breadcrumb(location) + ' prepare handler failed: ', err)
// High-cardinality ID as prefix
logger.info(`${transferId} — processing transfer`)
```

✅ **Good**
```javascript
// Literal prefix
logger.error('transfer processing failed: ', err)

// const logPrefix reused across multiple log statements
const logPrefix = `domain::${payload.transferId ? 'transfer' : 'fxTransfer'}::prepare`
logger.debug(`${logPrefix}::start: `, { headers })
logger.info(`${logPrefix}::done: `, { result })
logger.error(`${logPrefix}::failed: `, err)

// Preferred: child logger scopes context structurally
const log = logger.child({ component: 'domain::prepare', transferId })
log.debug('start: ', { headers })
log.info('done: ', { result })
log.error('failed: ', err)
```

---

### no-string-interpolation-context

**Description:** Dynamic values embedded in message strings instead of structured attributes. Structured attributes are searchable in log aggregators and enable filtering/alerting. Note: string interpolation with a constant prefix is acceptable per `constant-log-prefix` — this rule targets cases where structured attributes would be more appropriate.

**Severity:** `Warning`

**Standard Traceability:**
- `standard/data_model.md`: "The message (Body) should be human-readable and self-explanatory... Use structured attributes for dynamic values."

**Examples:**

❌ **Bad**
```javascript
logger.info(`dfsp ${dfspId} with type ${proxyType} has proxy created`)
```

✅ **Good**
```javascript
logger.info('proxy created: ', { dfspId, proxyType, endpoint })
// String interpolation with constant prefix is also acceptable
logger.info(`proxy created for ${dfspId} type=${proxyType}`)
```

---

### kafka-semantics

**Description:** Kafka-related logs missing OTel messaging attributes. Client code should use Kafka wrappers (e.g., `central-services-stream` consumer/producer) that handle messaging logging with proper OTel attributes — don't add messaging attributes manually in handler code.

**Severity:** `Warning`

**Standard Traceability:**
- `standard/scenarios/kafka_messaging.md`: OTel messaging semantic conventions for Kafka

**Examples:**

❌ **Bad**
```javascript
logger.verbose('producing message to topic')
```

✅ **Good**
```javascript
logger.verbose('producing message to topic', {
  'messaging.system': 'kafka',
  'messaging.destination.name': 'topic-transfer-prepare',
  'messaging.operation.name': 'send'
})
```

---

### no-silent-catch

**Description:** Catch blocks that neither log nor rethrow — silently swallowed errors. Complements `catch-and-log-bubble` (which catches the opposite: catch-log-rethrow).

**Severity:** `Warning`

**Standard Traceability:**
- `standard/best_practices.md`: "Do **NOT** silently swallow errors."
- `standard/scenarios/error_handling.md`: error visibility requirements

**Examples:**

❌ **Bad**
```javascript
try { await doSomething() } catch (err) { return null }
```

✅ **Good**
```javascript
try {
  await doSomething()
} catch (err) {
  logger.warn('operation failed, returning null: ', err)
  return null
}
```

---

### no-loop-logging

**Description:** Logging inside tight loops (for, while, forEach). Should batch or log aggregates to avoid log flooding.

**Severity:** `Warning`

**Standard Traceability:**
- `standard/best_practices.md`: "Avoid logging inside tight loops — batch or log aggregates."

**Examples:**

❌ **Bad**
```javascript
for (const t of transfers) {
  logger.verbose('processing transfer: ', { transferId: t.id })
}
```

✅ **Good**
```javascript
logger.verbose(`processing batch of transfers [count: ${transfers.length}]...`)
```

---

### expected-error-level

**Description:** Known expected/recoverable errors logged at `error` instead of `warn`. Specific patterns: ER_DUP_ENTRY, constraint violations, validation failures, retries.

**Severity:** `Warning`

**Standard Traceability:**
- `standard/log_levels.md`: "Expected errors (e.g., duplicate key on idempotent write) are WARN, not ERROR."

**Examples:**

❌ **Bad**
```javascript
logger.error('Duplicate entry: ', err) // ER_DUP_ENTRY from idempotent write
```

✅ **Good**
```javascript
logger.warn('Duplicate entry (idempotent write): ', err)
```

---

### fspiop-header-handling

**Description:** FSPIOP-Signature must be hashed before logging, not logged raw. FSPIOP-Encryption: log metadata/algorithm only.

**Severity:** `Error`

**Standard Traceability:**
- `standard/scenarios/http_requests.md`: "FSPIOP-Signature must be hashed; FSPIOP-Encryption metadata only."

**Examples:**

❌ **Bad**
```javascript
logger.info('request headers: ', { 'fspiop.signature': req.headers['fspiop-signature'] })
```

✅ **Good**
```javascript
logger.info('request signature.hash: ', { 'fspiop.signature.hash': hash(sig) })
```

---

### sql-no-raw-values

**Description:** SQL query text in log attributes must use parameterized placeholders, not interpolated values. Client code should not log DB queries directly — use a centralized DB wrapper that handles query logging with proper OTel attributes (e.g., `createMysqlQueryBuilder` pattern in quoting-service).

**Severity:** `Error`

**Standard Traceability:**
- `standard/scenarios/sql_queries.md`: "Query text must use parameterized placeholders."

**Examples:**

❌ **Bad**
```javascript
// Raw query with interpolated values
logger.debug('Query', { 'db.query.text': `SELECT * FROM users WHERE email = '${email}'` })
// Client code logging query at all
logger.debug('executing query: ', { sql: knexQuery.toString() })
```

✅ **Good**
```javascript
// DB wrapper handles logging with parameterized query and OTel attributes
// See: quoting-service/src/data/createMysqlQueryBuilder.js for reference implementation
```

---

### exception-attributes

**Description:** Manually specified error attributes must use OTel names (`exception.type`, `exception.message`, `exception.stacktrace`), not camelCase variants. Additionally, `error.type` (the low-cardinality classifier) must follow the resolution order: `err.code` → `err.name` → `"UnknownError"`. Do not set both `exception.type` and `error.type` unless they carry genuinely different values.

**Severity:** `Warning`

**Standard Traceability:**
- `standard/scenarios/error_handling.md`: "Use OTel exception semantic conventions for error attributes."
- `standard/scenarios/error_handling.md`: "`error.type` resolution order: err.code → err.name → 'UnknownError'"

**Examples:**

❌ **Bad**
```javascript
logger.error('error in transferHandler: ', { errorType: err.name, stackTrace: err.stack })
```

✅ **Good**
```javascript
// Pass error object directly — contextLogger handles OTel attributes
logger.error('error in transferHandler: ', err)
```

---

### no-silent-function

**Description:** Functions in handler, domain, or service directories must have at least one log statement. A function with no logging is invisible to operators — failures, slow paths, and unexpected branches go undetected. The log level should reflect the function's importance:
- **`info`** — significant business events (transfer committed, participant created, settlement completed)
- **`verbose`** — routine operations (handler entry/exit, operation completions, flow tracing)
- **`debug`** — internal details (cache lookups, intermediate state, config resolution)

Does not apply to: pure utility/helper functions (math, formatting, validation predicates), functions under 3 lines, re-exports, or test files.

**Severity:** `Warning`

**Standard Traceability:**
- `standard/best_practices.md`: "Observability requires logging at business logic boundaries."
- `standard/log_levels.md`: level-to-audience mapping (info = operators, verbose/debug = developers)

**Examples:**

❌ **Bad**
```javascript
// Handler function with zero logging — completely invisible to operators
const processFulfilMessage = async (message) => {
  const transfer = await getTransferById(message.transferId)
  const result = await validateAndCommit(transfer, message)
  await publishNotification(result)
  return result
}
```

✅ **Good**
```javascript
const processFulfilMessage = async (message) => {
  const { transferId } = message
  const log = logger.child({ transferId })
  log.verbose('processFulfilMessage...')
  const transfer = await getTransferById(transferId)
  const result = await validateAndCommit(transfer, message)
  await publishNotification(result)
  log.info('transfer fulfilled: ', { transferId, state: result.state })
  return result
}
```

❌ **Bad**
```javascript
// Domain function — silently queries and returns
const getParticipantByName = async (name) => {
  const participant = await ParticipantModel.getByName(name)
  if (!participant) throw new Error(`Participant not found: ${name}`)
  return participant
}
```

✅ **Good**
```javascript
const getParticipantByName = async (name) => {
  logger.verbose('getParticipantByName...')
  const participant = await ParticipantModel.getByName(name)
  if (!participant) throw new Error(`Participant not found: ${name}`)
  logger.verbose('getParticipantByName - done: ', { name, participantId: participant.participantId })
  return participant
}
```
