# Agent Skills

A collection of agent skills providing domain-specific knowledge for working with Mojaloop/COMESA infrastructure repositories.

Skills are stored as `SKILL.md` files under `skills/<skill-name>/`

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
