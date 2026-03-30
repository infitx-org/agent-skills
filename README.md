# Agent Skills

A collection of agent skills providing domain-specific knowledge for working with Mojaloop/COMESA infrastructure repositories.

Skills are stored as `SKILL.md` files under `skills/<skill-name>/`

Learn more about what skills are and how they work in the [Agent Skills documentation](https://agentskills.io/what-are-skills).

## Installation

### Project (Install to current project)
```bash
npx skills add infitx-org/agent-skills -s '*'
```

### Global (Install to user directory instead of project)
```bash
npx skills add infitx-org/agent-skills -g -s '*'
```

Refer this [Documentation](https://github.com/vercel-labs/skills?tab=readme-ov-file#skills) for all commands

## Available Skills

### `addon-creator`

**Description:** Creates new addons for Kubernetes deployments using the Mojaloop addon structure.

Use this skill when:

- Creating a new addon with one or more applications
- Adding a new application to an existing addon
- Setting up developer tools, monitoring, testing, or operational utilities for Mojaloop environments
- Creating reusable application bundles deployable across multiple environments

The skill enforces the **new addon structure** with self-contained per-app configuration in `.config/<app-name>.yaml`
and an ArgoCD Application definition in `<app-name>.app.yaml`.

### `addon-migrator`

**Description:** Migrates existing addons from the old structure to the new structure.

Use this skill when:

- Migrating an existing addon from old to new structure
- Modernizing legacy addon repositories
- Preparing addons for distribution as reusable packages
- Consolidating addon configuration for better isolation

The skill guides migration from the deprecated flat `app-yamls/` + `default.yaml` structure to the modular per-app structure.

### `ml-logging-linter`

**Description:** Scans JS/TS files for Mojaloop logging rule violations and produces a report with fix suggestions.

Use this skill when:

- Auditing JS/TS code for logging quality
- Reviewing logging practices across a Mojaloop service
- Checking if log statements follow standards (error handling, trace context, log levels, sensitive data, OTel attributes)
- Preparing a PR that touches logging code
- Assessing logging hygiene in any Mojaloop/PM4ML codebase

The skill uses LLM-powered semantic analysis rather than AST parsing, complementing the ESLint plugin used for CI enforcement.
