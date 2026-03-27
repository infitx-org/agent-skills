---
name: addon-migrator
description: A skill for migrating existing addons from the old structure to the new structure in the addons repository.
---

# Addon Migrator Skill

## When to Use This Skill

Use this skill when:
- Migrating an existing addon from old to new structure
- Modernizing legacy addon repositories
- Preparing addons for distribution as reusable packages
- Consolidating addon configuration for better isolation

## Structure Comparison

### Old Structure (Deprecated)

```
addons-dev/
├── app-yamls/                    # Centralized ArgoCD Applications
│   ├── app-1.yaml
│   ├── app-2.yaml
│   └── ...
├── default.yaml                  # Centralized configuration
├── app-1/                        # App resources
│   ├── kustomization.yaml
│   ├── values-default.yaml
│   └── ...
└── app-2/                        # App resources
    ├── kustomization.yaml
    └── ...
```

**Characteristics:**
- All ArgoCD Application definitions in `app-yamls/` folder
- All app configurations in root `default.yaml` file
- Configuration uses flattened structure with prefixes (e.g., `app-1Enabled`, `app-1SyncWave`)
- Hard to reuse addons across different repositories
- No clear grouping of related apps

### New Structure (Current)

```
addons/
└── addon-name/
    ├── app-1/
    │   ├── .config/
    │   │   └── app-1.yaml        # App-specific configuration
    │   ├── app-1.app.yaml        # ArgoCD Application definition
    │   ├── kustomization.yaml
    │   └── ...
    └── app-2/
        ├── .config/
        │   └── app-2.yaml        # App-specific configuration
        ├── app-2.app.yaml        # ArgoCD Application definition
        ├── kustomization.yaml
        └── ...
```

**Characteristics:**
- Each app has its own `.app.yaml` file in its directory
- Configuration moved to `.config/<app-name>.yaml` per app
- Better encapsulation and modularity
- Easier to reuse as git submodules
- Clear grouping by addon name

## Key Migration Changes

### 1. ArgoCD Application Definition Location

**Old:** `app-yamls/<app-name>.yaml`
**New:** `<addon-name>/<app-name>/<app-name>.app.yaml`

**Template path change:**
- Old: `path: apps/<app-name>`
- New: `path: addons/<addon-name>/<app-name>`

### 2. Configuration Structure

**Old:** Flat structure in `default.yaml`
```yaml
app-yamls:
    app-1Enabled: false
    app-1SyncWave: 0
    app-1Namespace: app-1

app-1:
    version: 1.0.0
    values: {}
```

**New:** Nested structure in `.config/<app-name>.yaml`
```yaml
enabled: false
syncWave: 0
namespace: app-1
version: 1.0.0
values: {}
```

### 3. Template Variable References

**Old:** Used `app.<app-name>Enabled`, `app.<app-name>Namespace`
**New:** Uses `app.enabled`, `app.namespace`

## Step-by-Step Migration Instructions

### Step 1: Analyze Current Addon

**Gather information:**

1. List all apps in the addon:
   ```bash
   ls -d */ | grep -v app-yamls
   ```

2. Identify app configurations in `default.yaml`:
   ```bash
   grep -E "^[a-z-]+:" default.yaml
   ```

3. Check corresponding ArgoCD applications:
   ```bash
   ls app-yamls/
   ```

**Create migration checklist:**
- [ ] List of all apps to migrate
- [ ] Configuration keys per app from `default.yaml`
- [ ] Special features (secrets, configmaps, dependencies)
- [ ] External dependencies between apps

### Step 2: Create New Directory Structure

For each app in the addon:

```bash
# Create .config directory
mkdir -p <app-name>/.config

# If grouping into addon (optional for single repos)
mkdir -p <addon-name>/<app-name>/.config
```

### Step 3: Migrate Configuration

For each app, create `.config/<app-name>.yaml` from `default.yaml`:

**Extract configuration:**

1. Identify app-specific configuration in `default.yaml`:
   - Look for `app-yamls` section entries
   - Look for app name as top-level key
   - Look for custom configuration

2. Transform configuration structure:

**Example transformation:**

**Old `default.yaml`:**
```yaml
app-yamls:
    chaosmeshEnabled: false
    chaosmeshSyncWave: 0
    chaosmeshNamespace: chaosmesh

chaosmesh:
    version: 2.7.0
    values: {}
```

**New `.config/chaosmesh.yaml`:**
```yaml
enabled: false
syncWave: 0
namespace: chaosmesh
version: 2.7.0
values: {}
```

**Migration mapping:**

| Old Key Pattern | New Key | Notes |
|-----------------|---------|-------|
| `<app>Enabled` | `enabled` | Boolean flag |
| `<app>SyncWave` | `syncWave` | Integer |
| `<app>Namespace` | `namespace` | String |
| `<app>: version` | `version` | From app section |
| `<app>: values` | `values` | From app section |
| `<app>: tag` | `tag` | Image tag |
| `<app>: image` | `image` | Full image ref |
| `<app>: <custom>` | `<custom>` | Any custom fields |

**Script to assist migration:**

```bash
#!/bin/bash
# migrate-config.sh - Helper to extract app config

APP_NAME=$1
if [ -z "$APP_NAME" ]; then
    echo "Usage: $0 <app-name>"
    exit 1
fi

# Extract from app-yamls section
echo "# Configuration for $APP_NAME"
echo "enabled: false  # TODO: Check default.yaml for ${APP_NAME}Enabled"
echo "syncWave: 0     # TODO: Check default.yaml for ${APP_NAME}SyncWave"
echo "namespace: $APP_NAME  # TODO: Check default.yaml for ${APP_NAME}Namespace"
echo ""

# Extract from app section
echo "# From default.yaml $APP_NAME section:"
awk "/^$APP_NAME:$/,/^[a-z-]+:/" default.yaml | head -n -1 | tail -n +2
```

### Step 4: Migrate ArgoCD Application Definition

For each app, move and update the ArgoCD Application file:

**1. Copy the application file:**
```bash
cp app-yamls/<app-name>.yaml <app-name>/<app-name>.app.yaml
```

**2. Update path reference:**

**Old:**
```yaml
spec:
  source:
    path: apps/<app-name>
    repoURL: ${cluster.gitlabProjectUrl}
```

**New:**
```yaml
spec:
  source:
    path: addons/<addon-name>/<app-name>
    repoURL: ${cluster.gitlabProjectUrl}
```

**3. Update template variable references:**

**Old template variables:**
- `${app.<app-name>Enabled}` → `${app.enabled}`
- `${app.<app-name>Namespace}` → `${app.namespace}`
- `${app.<app-name>SyncWave}` → `${app.syncWave}`

**Example transformation:**

**Old `app-yamls/chaosmesh.yaml`:**
```yaml
# %{ if app.chaosmeshEnabled }
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "${app.chaosmeshSyncWave}"
  name: chaosmesh
  namespace: argocd
spec:
  source:
    path: apps/chaosmesh
    repoURL: ${cluster.gitlabProjectUrl}
  destination:
    namespace: ${app.chaosmeshNamespace}
    server: https://kubernetes.default.svc
  # ... rest of spec
# %{ endif }
```

**New `chaosmesh/chaosmesh.app.yaml`:**
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "${app.syncWave}"
  name: ${app.name}
  namespace: argocd
spec:
  source:
    path: addons/addon-name/${app.name}
    repoURL: ${cluster.gitlabProjectUrl}
  destination:
    namespace: ${app.namespace}
    server: https://kubernetes.default.svc
  # ... rest of spec
```

**4. Add addon annotation (optional but recommended):**
```yaml
spec:
  source:
    kustomize:
      commonAnnotations:
        addon: <addon-name>
```

**Find and replace commands:**
```bash
# In the .app.yaml file
sed -i 's|path: apps/<app-name>|path: addons/<addon-name>/<app-name>|' <app-name>.app.yaml
sed -i 's|app\.<app-name>Enabled|app.enabled|g' <app-name>.app.yaml
sed -i 's|app\.<app-name>Namespace|app.namespace|g' <app-name>.app.yaml
sed -i 's|app\.<app-name>SyncWave|app.syncWave|g' <app-name>.app.yaml
```

### Step 5: Update Template Variable References in Manifests

Check all YAML files in the app directory for old template variable patterns:

```bash
# Find files with old variable patterns
grep -r "app\.<app-name>" <app-name>/

# Common files to check:
# - kustomization.yaml
# - values-default.yaml
# - deployment.yaml
# - vs.yaml
# - any other resource files
```

**Update patterns:**
- `${app.<app-name>}` → `${app.<field>}`
- Keep `${app.version}`, `${app.tag}`, `${app.image}` as-is (these stay the same pattern)

**Example:**

**Old `values-default.yaml`:**
```yaml
image:
  tag: ${chaosmesh.tag}
```

**New `values-default.yaml`:**
```yaml
image:
  tag: ${app.tag}
```

### Step 6: Handle Cross-App Dependencies

If apps reference each other's configuration, update the references:

**Old pattern:**
```yaml
# In app-1 referencing app-2
endpoint: ${app-2.endpoint}
```

**New pattern:**
```yaml
# Cross-app references use apps.<app-name>.<field>
endpoint: ${apps.app-2.endpoint}
```

**Note:** Dependencies in `.config/<app-name>.yaml` can reference other apps:

```yaml
# .config/app-1.yaml
enabled: true
dependsOn: app-2
endpoint: ${apps.app-2.endpoint}
```

### Step 7: Create Environment Override Structure

If you have environment-specific overrides, they move to:

**Old:** Inline in environment's `custom-config/default.yaml` or profile files
**New:** `custom-config/<app-name>.yaml` per app

**Example:**

**Old `custom-config/default.yaml`:**
```yaml
chaosmeshEnabled: true
chaosmeshNamespace: custom-chaos
chaosmesh:
    version: 2.8.0
```

**New `custom-config/chaosmesh.yaml`:**
```yaml
enabled: true
namespace: custom-chaos
version: 2.8.0
```

### Step 8: Verification Checklist

Before committing changes:

- [ ] All apps have `.config/<app-name>.yaml` files
- [ ] All apps have `<app-name>.app.yaml` files in their directories
- [ ] All path references updated to new structure
- [ ] All template variables updated (no `app.<app-name>...` patterns)
- [ ] kustomization.yaml works: `kustomize build <app-name>/`
- [ ] No references to old `app-yamls/` directory remain
- [ ] Configuration is complete (no missing fields)
- [ ] Dependencies between apps are correctly referenced

**Validation commands:**

```bash
# Check for old variable patterns
grep -r "app\.[a-z-]*Enabled" <addon-name>/
grep -r "app\.[a-z-]*Namespace" <addon-name>/
grep -r "app\.[a-z-]*SyncWave" <addon-name>/

# Check for old path references
grep -r "path: apps/" <addon-name>/

# Validate kustomization builds
for app in <addon-name>/*/; do
    echo "Validating $app"
    kustomize build "$app" > /dev/null || echo "ERROR in $app"
done
```

### Step 9: Update Documentation

1. Update README.md to reflect new structure
2. Document configuration options in each app's .config file
3. Add migration notes if maintaining backward compatibility
4. Update any environment setup guides

### Step 10: Clean Up Old Structure

After verifying the migration works:

1. Move `app-yamls/` to `app-yamls.old/` (backup)
2. Move `default.yaml` to `default.yaml.old` (backup)
3. Update any CI/CD scripts that reference old paths
4. Update GitLab/GitHub templates if used

```bash
# Backup old structure
mv app-yamls app-yamls.old
mv default.yaml default.yaml.old

# After confirming everything works in production
rm -rf app-yamls.old
rm default.yaml.old
```

## Migration Example: Complete Walkthrough

Let's migrate the `chaosmesh` addon as an example:

### Before Migration

```
addons-dev/
├── app-yamls/
│   └── chaosmesh.yaml
├── default.yaml
└── chaosmesh/
    ├── kustomization.yaml
    ├── values-default.yaml
    ├── values-override.yaml
    └── vs.yaml
```

**default.yaml content:**
```yaml
app-yamls:
    chaosmeshEnabled: false
    chaosmeshSyncWave: 0
    chaosmeshNamespace: chaosmesh

chaosmesh:
    version: 2.7.0
    values: {}
```

**app-yamls/chaosmesh.yaml:**
```yaml
# %{ if app.chaosmeshEnabled }
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "${app.chaosmeshSyncWave}"
  name: chaosmesh
  namespace: argocd
spec:
  source:
    path: apps/chaosmesh
    repoURL: ${cluster.gitlabProjectUrl}
  destination:
    namespace: ${app.chaosmeshNamespace}
    server: https://kubernetes.default.svc
  # ... rest
# %{ endif }
```

### Migration Steps

**1. Create .config directory:**
```bash
mkdir -p chaosmesh/.config
```

**2. Create chaosmesh/.config/chaosmesh.yaml:**
```yaml
enabled: false
syncWave: 0
namespace: chaosmesh
version: 2.7.0
values: {}
```

**3. Move and update ArgoCD application:**
```bash
cp app-yamls/chaosmesh.yaml chaosmesh/chaosmesh.app.yaml
```

Edit `chaosmesh/chaosmesh.app.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "${app.syncWave}"
  name: ${app.name}
  namespace: argocd
spec:
  source:
    path: addons/dev-addons/${app.name}
    repoURL: ${cluster.gitlabProjectUrl}
    kustomize:
      commonAnnotations:
        addons-dev: ${app.name}
  destination:
    namespace: ${app.namespace}
    server: https://kubernetes.default.svc
  # ... rest
```

**4. No template variable changes needed in other files** (chaosmesh already uses `${app.version}`)

**5. Verify:**
```bash
kustomize build chaosmesh/
```

### After Migration

```
addons/
└── dev-addons/
    └── chaosmesh/
        ├── .config/
        │   └── chaosmesh.yaml
        ├── chaosmesh.app.yaml
        ├── kustomization.yaml
        ├── values-default.yaml
        ├── values-override.yaml
        └── vs.yaml
```

## Automated Migration Script

Here's a helper script to automate parts of the migration:

```bash
#!/bin/bash
# migrate-addon.sh - Automate addon migration

set -e

APP_NAME=$1
ADDON_NAME=${2:-"dev-addons"}

if [ -z "$APP_NAME" ]; then
    echo "Usage: $0 <app-name> [addon-name]"
    exit 1
fi

echo "Migrating $APP_NAME to $ADDON_NAME structure..."

# 1. Create directory structure
echo "Creating .config directory..."
mkdir -p "$APP_NAME/.config"

# 2. Extract and create config file
echo "Creating .config/$APP_NAME.yaml..."
cat > "$APP_NAME/.config/$APP_NAME.yaml" << EOF
# TODO: Review and complete this configuration
# Extracted from default.yaml

# Enable/disable flag
enabled: false  # Check: default.yaml app-yamls.${APP_NAME}Enabled

# ArgoCD settings
syncWave: 0     # Check: default.yaml app-yamls.${APP_NAME}SyncWave
namespace: $APP_NAME  # Check: default.yaml app-yamls.${APP_NAME}Namespace

# App-specific configuration (from default.yaml $APP_NAME section)
EOF

# Extract app config from default.yaml if it exists
if [ -f "default.yaml" ]; then
    echo "# Configuration from default.yaml:" >> "$APP_NAME/.config/$APP_NAME.yaml"
    awk "/^$APP_NAME:$/,/^[a-z-]+:/" default.yaml | head -n -1 | tail -n +2 >> "$APP_NAME/.config/$APP_NAME.yaml"
fi

# 3. Move and update ArgoCD application
if [ -f "app-yamls/$APP_NAME.yaml" ]; then
    echo "Migrating ArgoCD application..."
    cp "app-yamls/$APP_NAME.yaml" "$APP_NAME/$APP_NAME.app.yaml"

    # Update path
    sed -i "s|path: apps/$APP_NAME|path: addons/\${app.name}|" "$APP_NAME/$APP_NAME.app.yaml"

    # Update template variables
    sed -i "s|app\.${APP_NAME}Enabled|app.enabled|g" "$APP_NAME/$APP_NAME.app.yaml"
    sed -i "s|app\.${APP_NAME}Namespace|app.namespace|g" "$APP_NAME/$APP_NAME.app.yaml"
    sed -i "s|app\.${APP_NAME}SyncWave|app.syncWave|g" "$APP_NAME/$APP_NAME.app.yaml"
    sed -i "s|name: $APP_NAME|name: \${app.name}|g" "$APP_NAME/$APP_NAME.app.yaml"
    sed -i "s|addons-dev: $APP_NAME|addons-dev: \${app.name}|g" "$APP_NAME/$APP_NAME.app.yaml"

    echo "ArgoCD application migrated to $APP_NAME/$APP_NAME.app.yaml"
else
    echo "Warning: app-yamls/$APP_NAME.yaml not found"
fi

# 4. Check for old variable patterns in app directory
echo "Checking for template variables to update..."
if grep -r "app\.$APP_NAME" "$APP_NAME/" 2>/dev/null; then
    echo "WARNING: Found old template variable patterns. Please review:"
    grep -r "app\.$APP_NAME" "$APP_NAME/" | head -5
fi

echo ""
echo "Migration complete! Next steps:"
echo "1. Review and complete $APP_NAME/.config/$APP_NAME.yaml"
echo "2. Verify $APP_NAME/$APP_NAME.app.yaml"
echo "3. Test with: kustomize build $APP_NAME/"
echo "4. Update any remaining template variables"
echo "5. Create custom-config/$APP_NAME.yaml for environment overrides"
```

**Usage:**
```bash
chmod +x migrate-addon.sh
./migrate-addon.sh chaosmesh dev-addons
```

## Common Migration Issues

### Issue 1: Missing Configuration Fields

**Symptom:** Template variables don't resolve after migration

**Solution:**
- Check `.config/<app-name>.yaml` has all fields from old structure
- Verify field names match exactly (case-sensitive)
- Ensure YAML indentation is correct

### Issue 2: Path Not Found in ArgoCD

**Symptom:** ArgoCD reports source path doesn't exist

**Solution:**
- Update path in `.app.yaml`: `path: addons/<addon-name>/<app-name>`
- Ensure directory structure matches the path
- Verify git repository has the new structure

### Issue 3: Old Variable References Remain

**Symptom:** Errors about undefined variables like `app.<app-name>Namespace`

**Solution:**
```bash
# Find all occurrences
grep -r "app\.[a-z-]*Enabled" .
grep -r "app\.[a-z-]*Namespace" .
grep -r "app\.[a-z-]*SyncWave" .

# Replace with new pattern
# Use sed or manual editing
```

### Issue 4: Cross-App Dependencies Break

**Symptom:** Apps can't find configuration from other apps

**Solution:**
- Use `apps.<other-app>.<field>` for cross-app references
- Ensure dependent apps are enabled
- Check dependency order (syncWave)

### Issue 5: Environment Overrides Not Working

**Symptom:** Custom configuration not applied

**Solution:**
- Create `custom-config/<app-name>.yaml` per app
- Don't mix old and new config formats
- Ensure override file structure matches `.config/<app-name>.yaml`

## Testing Strategy

### 1. Local Testing

```bash
# Test kustomization builds
kustomize build <app-name>/

# Test template rendering (if using gomplate)
gomplate -f <app-name>/<app-name>.app.yaml \
  -c .config=<app-name>/.config/<app-name>.yaml
```

### 2. Development Environment Testing

1. Deploy to dev environment first
2. Enable single app at a time
3. Monitor ArgoCD sync status
4. Verify resources are created correctly
5. Check application functionality

### 3. Rollback Plan

Keep old structure until migration is verified:

```bash
# Restore old structure if needed
mv app-yamls.old app-yamls
mv default.yaml.old default.yaml
git checkout <commit-before-migration>
```

## Best Practices for Migration

1. **Migrate incrementally:** One app at a time or small batches
2. **Test thoroughly:** Verify each app works before moving to next
3. **Keep backups:** Don't delete old structure until confirmed working
4. **Document changes:** Update README and comments
5. **Communicate:** Inform team members about structure changes
6. **Version control:** Commit frequently with clear messages
7. **Parallel testing:** Keep old structure working during migration
8. **Review dependencies:** Map app dependencies before migration
9. **Validate templates:** Ensure all variables resolve correctly
10. **Update CI/CD:** Adjust automation scripts for new structure

## Post-Migration Checklist

- [ ] All apps migrated to new structure
- [ ] Old structure removed or archived
- [ ] Documentation updated
- [ ] CI/CD pipelines updated
- [ ] Team trained on new structure
- [ ] All environments tested
- [ ] Performance verified
- [ ] Rollback procedure documented
- [ ] Monitoring and alerts verified
- [ ] Security policies applied

## References

- Addon Creator Skill: [addon-creator/SKILL.md](../addon-creator/SKILL.md)
- Addon Specification: [iac-modules/docs/addons.md](../../../iac-modules/docs/addons.md)
- Kustomize Documentation: https://kustomize.io/
- ArgoCD Documentation: https://argo-cd.readthedocs.io/
- Template System Documentation: (gomplate, envsubst, or custom templating)
