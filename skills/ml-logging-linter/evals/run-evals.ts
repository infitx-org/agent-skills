#!/usr/bin/env node

/**
 * Eval runner for the ml-logging-linter skill.
 *
 * Reads evals/evals.json, runs each eval via `claude -p`, grades results
 * with an LLM-as-judge call, and writes structured results to evals/results/.
 *
 * Usage:
 *   node evals/run-evals.ts [--model <name>] [--grader-model <name>] [--eval-id <N>] [--skip-grading]
 */

import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { env } from 'node:process';

const execFileAsync = promisify(execFile);

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVALS_PATH = resolve(SKILL_DIR, 'evals/evals.json');
const RESULTS_DIR = resolve(SKILL_DIR, 'evals/results');

const { CLAUDECODE: _, ...SPAWN_ENV } = env;

const EVAL_TIMEOUT_MS = 300_000;
const GRADING_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 1_048_576;
const JSON_OBJECT_RE = /\{[\s\S]*\}/;

const log = (msg: string): boolean => process.stderr.write(`${msg}\n`);

interface EvalDefinition {
  id: number;
  name: string;
  prompt: string;
  expectations: string[];
}

interface EvalsFile {
  evals: EvalDefinition[];
}

interface SpawnClaudeOptions {
  prompt: string;
  model?: string | null; // (?) why not just - model?: string
  timeoutMs?: number;
  cwd?: string;
}

interface CliOptions {
  model: string | null;
  graderModel: string;
  evalId: number | null;
  skipGrading: boolean;
}

interface GradingExpectation {
  text: string;
  passed: boolean;
  evidence: string;
}

interface GradingSummary {
  passed: number;
  failed: number;
  total: number;
  passRate: number;
}

interface GradingResult {
  expectations: GradingExpectation[];
  summary: GradingSummary;
}

interface EvalRunResult {
  report: string;
  durationMs: number;
  start: number;
}

interface EvalResult {
  id: number;
  name: string;
  report: string | null;
  durationMs: number;
  evalDef: EvalDefinition;
  error?: string;
  grading?: GradingResult;
}

interface BenchmarkEntry {
  id: number;
  name: string;
  durationMs: number;
  grading?: GradingSummary;
}

interface Benchmark {
  timestamp: string;
  evals: BenchmarkEntry[];
  summary: {
    totalExpectations: number;
    passedExpectations: number;
    passRate: number;
  };
}

const { values: rawOpts } = parseArgs({
  options: {
    model: { type: 'string' },
    'grader-model': { type: 'string', default: 'haiku' },
    'eval-id': { type: 'string' },
    'skip-grading': { type: 'boolean', default: false },
  },
  strict: true,
});

const cliOpts = Object.freeze({
  model: rawOpts.model ?? null,
  graderModel: rawOpts['grader-model'] ?? 'haiku',
  evalId: rawOpts['eval-id'] != null ? Number(rawOpts['eval-id']) : null,
  skipGrading: rawOpts['skip-grading'] ?? false,
}) satisfies CliOptions;

const spawnClaude = async ({
  prompt,
  model,
  timeoutMs = EVAL_TIMEOUT_MS,
  cwd = SKILL_DIR,
}: SpawnClaudeOptions): Promise<string> => {
  const args = ['-p', prompt, '--output-format', 'json'];
  if (model) args.push('--model', model);

  try {
    const { stdout } = await execFileAsync('claude', args, {
      cwd,
      env: SPAWN_ENV,
      maxBuffer: MAX_BUFFER_BYTES,
      timeout: timeoutMs,
    });
    return stdout;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('"claude" CLI not found in PATH');
    }
    throw err;
  }
};

const extractReport = (rawJson: string): string => {
  const parsed = JSON.parse(rawJson);
  return parsed.result ?? parsed.text ?? JSON.stringify(parsed);
};

const formatDuration = (ms: number): string => `${Math.round(ms / 1_000)}s`;

const runEval = async (evalDef: EvalDefinition, model: string | null): Promise<EvalRunResult> => {
  const { prompt } = evalDef;
  const start = Date.now();
  const raw = await spawnClaude({ prompt, model });

  return {
    report: extractReport(raw),
    durationMs: Date.now() - start,
    start,
  };
};

const buildGradingPrompt = (expectations: string[], report: string): string =>
  `You are a strict eval grader. Evaluate whether the following report meets each expectation.

## Expectations
${expectations.map((e, i) => `${i + 1}. ${e}`).join('\n')}

## Report to evaluate
${report}

## Instructions
For each expectation, determine if it PASSED or FAILED based on the report content.
Provide brief evidence (a quote or observation) for each judgment.

Return ONLY valid JSON (no markdown fences, no extra text) in this exact structure:
{"expectations":[{"text":"...","passed":true,"evidence":"..."}],"summary":{"passed":0,"failed":0,"total":0,"passRate":0.0}}`;

const gradeEval = async (evalDef: EvalDefinition, report: string): Promise<GradingResult> => {
  const prompt = buildGradingPrompt(evalDef.expectations, report);
  const raw = await spawnClaude({
    prompt,
    model: cliOpts.graderModel,
    timeoutMs: GRADING_TIMEOUT_MS,
  });
  const text = extractReport(raw);
  const jsonMatch = text.match(JSON_OBJECT_RE);
  if (!jsonMatch) throw new Error(`Grader returned non-JSON: ${text.slice(0, 200)}`);
  return JSON.parse(jsonMatch[0]) as GradingResult;
};

const writeEvalResults = async (
  evalId: number,
  report: string,
  grading: GradingResult | null,
): Promise<void> => {
  const dir = resolve(RESULTS_DIR, `eval-${evalId}`);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'report.md'), report, 'utf8');
  if (grading) {
    await writeFile(resolve(dir, 'grading.json'), JSON.stringify(grading, null, 2), 'utf8');
  }
};

const writeBenchmark = async (results: EvalResult[]): Promise<Benchmark> => {
  const { totalExpectations, passedExpectations } = results.reduce(
    (acc, r) => ({
      totalExpectations: acc.totalExpectations + (r.grading?.summary?.total ?? 0),
      passedExpectations: acc.passedExpectations + (r.grading?.summary?.passed ?? 0),
    }),
    { totalExpectations: 0, passedExpectations: 0 },
  );
  const benchmark: Benchmark = {
    timestamp: new Date().toISOString(),
    evals: results.map((r) => ({
      id: r.id,
      name: r.name,
      durationMs: r.durationMs,
      ...(r.grading && { grading: r.grading.summary }),
    })),
    summary: {
      totalExpectations,
      passedExpectations,
      passRate: totalExpectations > 0 ? passedExpectations / totalExpectations : 0,
    },
  };
  await writeFile(resolve(RESULTS_DIR, 'benchmark.json'), JSON.stringify(benchmark, null, 2), 'utf8');
  return benchmark;
};

const main = async (): Promise<void> => {
  await mkdir(RESULTS_DIR, { recursive: true });
  const evalsFile = JSON.parse(await readFile(EVALS_PATH, 'utf8')) as EvalsFile;
  let evals = evalsFile.evals;
  if (cliOpts.evalId != null) {
    evals = evals.filter((e) => e.id === cliOpts.evalId);
    if (evals.length === 0) {
      log(`Error: eval id ${cliOpts.evalId} not found.`);
      process.exit(1);
    }
  }
  log(`Running ${evals.length} eval(s)...`);

  const runOne = async (evalDef: EvalDefinition): Promise<EvalResult> => {
    process.stderr.write(`  Eval ${evalDef.id} (${evalDef.name})... `);
    try {
      const { report, durationMs } = await runEval(evalDef, cliOpts.model);
      log(`done (${formatDuration(durationMs)})`);
      return { id: evalDef.id, name: evalDef.name, report, durationMs, evalDef };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log(`FAILED (${message})`);
      return { id: evalDef.id, name: evalDef.name, report: null, durationMs: 0, error: message, evalDef };
    }
  };

  const results = await Promise.all(evals.map(runOne));
  if (!cliOpts.skipGrading) {
    log('\nGrading...');
    const gradeOne = async (result: EvalResult): Promise<void> => {
      if (!result.report) {
        log(`  Eval ${result.id}: SKIPPED (no report)`);
        return;
      }
      try {
        result.grading = await gradeEval(result.evalDef, result.report);
        const { passed, total } = result.grading.summary;
        const status = passed === total ? 'PASS' : 'FAIL';
        log(`  Eval ${result.id}: ${passed}/${total} ${status}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log(`  Eval ${result.id}: GRADING ERROR (${message})`);
      }
    };
    await Promise.allSettled(results.map(gradeOne));
  }

  const writeOps = results
    .filter((r): r is EvalResult & { report: string } => r.report !== null)
    .map((r) => writeEvalResults(r.id, r.report, r.grading ?? null));
  await Promise.all(writeOps);

  const benchmark = await writeBenchmark(results);
  if (!cliOpts.skipGrading) {
    const { passedExpectations: passed, totalExpectations: total } = benchmark.summary;
    const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
    log(`\nOverall: ${passed}/${total} (${pct}%)`);
  }
  log(`Results written to evals/results/`);
};

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  log(`error in run-evals main(): ${message}  [stack: ${stack}]`);
  process.exit(1);
});
