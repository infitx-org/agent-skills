---
name: addon-creator
description: A skill for creating new addons for Kubernetes deployments using the Mojaloop addon structure.
---

## IMPORTANT: Structure Requirements

**⚠️ MANDATORY: All new addons MUST use the NEW structure described below.**

The repository may contain some addons using an older structure (with `app-yamls/*.yaml` and configuration in `default.yaml`). **DO NOT use this old structure for new addons.** The old structure is deprecated and exists only for backward compatibility with existing addons.

## When to Use This Skill

Use this skill when:
- Creating a new addon with one or more applications
- Adding a new application to an existing addon
- Setting up developer tools, monitoring, testing, or operational utilities for Mojaloop environments
- Creating reusable application bundles that can be deployed across multiple environments

## Addon Structure Overview

### NEW Structure (REQUIRED for all new addons)

```
addons/
└── <app-name>/
    ├── .config/
    │   └── <app-name>.yaml         # App configuration (REQUIRED)
    ├── <app-name>.app.yaml         # ArgoCD Application definition (REQUIRED)
    ├── kustomization.yaml          # Kustomize manifest (REQUIRED)
    ├── values-default.yaml         # Default Helm values (if using Helm)
    ├── values-override.yaml        # Template for env-specific overrides (if using Helm)
    ├── vs.yaml                     # Virtual Service for ingress (optional)
    ├── <resource>.yaml             # Additional K8s resources
    ├── README.md                   # Documentation (recommended)
    └── <subfolder>/                # Optional: misc files without templating
```

**Key characteristics of the NEW structure:**
- Configuration is in `.config/<app-name>.yaml` (self-contained per app)
- App definition is in `<app-name>.app.yaml` at the app root
- Template variables use `${app.*}` to reference config from `.config/<app-name>.yaml`
- No entries needed in `default.yaml` or `app-yamls/` directory

### OLD Structure (DEPRECATED - Do NOT use for new addons)

```
addons/
├── app-yamls/
│   └── <app-name>.yaml            # ArgoCD Application (OLD - deprecated)
├── default.yaml                   # Global configuration (OLD - deprecated)
└── <app-name>/
    ├── kustomization.yaml
    ├── deployment.yaml
    └── ...
```

**The OLD structure is deprecated because:**
- Configuration scattered across `default.yaml` and app-specific files
- App definitions in separate `app-yamls/` directory
- Harder to manage and understand dependencies
- Less modular and reusable

**When you encounter old-structure addons in the repository, do NOT replicate their pattern. Always use the NEW structure.**

## Step-by-Step Instructions

### 1. Determine App Name

**Questions to answer:**
- What is the app name? (e.g., `redis-insight`, `mongo-express`, `cloud-beaver`)
- What namespace should the app use? (default: same as app name)
- Does it need persistent storage?
- Does it need ingress/virtual service?

**Naming conventions:**
- Use lowercase with hyphens: `redis-insight`, `chaos-mesh`, `mongo-express`
- App names should be descriptive and match the tool being deployed
- Namespace typically matches the app name

**⚠️ IMPORTANT: Do NOT create files in `app-yamls/` directory or add configuration to `default.yaml`. These are part of the deprecated old structure.**

### 2. Create App Directory Structure

Navigate to the addons repository (e.g., `/home/kalin/work/deploy/addons-dev/`) and create:

```bash
mkdir -p <app-name>/.config
cd <app-name>
```

**Directory structure you will create:**
```
<app-name>/
├── .config/
│   └── <app-name>.yaml      # Start here
├── <app-name>.app.yaml      # Then create this
├── kustomization.yaml       # Then this
└── ... other resources
```

### 3. Create App Configuration File

**This is the FIRST file to create**: `.config/<app-name>.yaml`

This file contains all configuration for your app. Template variables in your manifests will reference fields from this file using `${app.<field>}`.

Create `.config/<app-name>.yaml` with default configuration:

```yaml
# .config/<app-name>.yaml
enabled: true
version: <chart-version>     # For Helm charts
tag: <image-tag>             # For container images
namespace: <app-name>        # Default namespace
syncWave: 0                  # ArgoCD sync wave (use negative for dependencies)
values: {}                   # Helm chart value overrides
```

**Common configuration fields:**
- `enabled`: Boolean to enable/disable the app
- `version`: Helm chart version (if using Helm)
- `tag`: Docker image tag (if using plain manifests)
- `namespace`: Kubernetes namespace for deployment
- `syncWave`: ArgoCD sync wave for ordering (-1 for infrastructure, 0 for apps, 99+ for tests)
- `values`: Hash for Helm chart value overrides
- `image`: Full image reference (for non-Helm deployments)

**Examples from existing addons:**

```yaml
# chaosmesh
enabled: true
version: 2.7.0
namespace: chaosmesh
syncWave: 0
values: {}
```

```yaml
# cloud-beaver
enabled: true
image: dbeaver/cloudbeaver:25.0.4
namespace: cloud-beaver
syncWave: 0
secrets:
    account-lookup: common-mojaloop-db-secret
    central-ledger: common-mojaloop-db-secret
```

```yaml
# k6
enabled: true
version: 3.9.0
namespace: k6
syncWave: 0
prometheusEndpoint: http://prom-kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090/api/v1/write
values: {}
```

### 4. Create ArgoCD Application Definition

Create `<app-name>.app.yaml`:

```yaml
# <app-name>.app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "${app.syncWave}"
  name: ${app.name}
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  source:
    path: apps/${app.name}
    repoURL: ${cluster.gitlabProjectUrl}
    targetRevision: HEAD
    kustomize:
      commonAnnotations:
        addons-dev: ${app.name}
  destination:
    namespace: ${app.namespace}
    server: https://kubernetes.default.svc
  project: default
  ignoreDifferences:
    - group: batch
      kind: CronJob
      jsonPointers:
      - /spec/suspend
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    retry:
      limit: 5
      backoff:
        duration: 5s
        maxDuration: 3m0s
        factor: 2
    syncOptions:
      - CreateNamespace=true
      - PrunePropagationPolicy=background
      - PruneLast=true
```

**Key elements:**
- `path`: Points to the addon's app directory
- `repoURL`: Uses `${cluster.gitlabProjectUrl}` template variable
- `destination.namespace`: Uses `${app.namespace}` template variable
- `syncWave`: Uses `${app.syncWave}` template variable
- `syncPolicy.automated`: Enables auto-sync and self-healing
- `syncOptions`: Common options for namespace creation and pruning

### 5. Create Kustomization File

The `kustomization.yaml` defines which Kubernetes resources to include.

**For Helm-based apps:**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - vs.yaml                    # Optional: if app has ingress
  - <additional-resources>.yaml
helmCharts:
  - name: <chart-name>
    releaseName: <release-name>
    version: ${app.version}
    repo: https://<chart-repo-url>
    valuesFile: values-default.yaml
    namespace: <app-name>
    includeCRDs: true
    additionalValuesFiles:
      - values-override.yaml
```

**Example (k6):**
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - vs.yaml
  - k6-test-als-configmap.yaml
  - kronic.yaml
helmCharts:
  - name: k6-operator
    releaseName: k6-operator
    version: ${app.version}
    repo: https://grafana.github.io/helm-charts
    valuesFile: values-default.yaml
    namespace: k6
    includeCRDs: true
    additionalValuesFiles:
      - values-override.yaml
```

**For plain manifest apps:**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
  - vs.yaml
  - external-secret.yaml
  - pvc.yaml
configMapGenerator:
  - name: <app-name>
    files:
      - config-file.conf
```

**Example (cloud-beaver):**
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - external-secret.yaml
  - password-policy.yaml
  - pvc.yaml
  - random-secret.yaml
  - service.yaml
  - vault-secret.yaml
  - vs.yaml
configMapGenerator:
  - name: cloud-beaver
    files:
      - cloudbeaver.conf
      - initial-data-sources.conf
```

### 6. Create Helm Values Files (for Helm-based apps)

**values-default.yaml** - Default values with templating:

```yaml
# values-default.yaml
image:
  tag: ${app.tag}

resources:
  limits:
    cpu: 1000m
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 128Mi

# App-specific configuration
config:
  option1: value1
  option2: value2
```

**Example (chaosmesh):**
```yaml
chaosDaemon:
  runtime: containerd
  socketPath: /var/snap/microk8s/common/run/containerd.sock
```

**Example (home/nginx):**
```yaml
image:
  tag: ${app.tag}

resources:
  limits:
    cpu: 200m
    memory: 256Mi
  requests:
    cpu: 50m
    memory: 64Mi

serverBlock: |-
  server {
    listen 8080;
    server_name _;
    location / {
      root /app;
      index index.html;
    }
  }
```

**values-override.yaml** - Template for environment-specific overrides:

```yaml
# values-override.yaml
# Environment-specific overrides can be added here
# These typically come from custom-config/<app-name>.yaml

# Example structure (commented out by default):
# ${app.values}
```

### 7. Create Kubernetes Resources

Create necessary Kubernetes resources based on deployment needs.

**Common resources:**

**Virtual Service (vs.yaml)** - For apps with web UI:

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: <app-name>
spec:
  gateways:
    - istio-ingress-int/internal-wildcard-gateway
  hosts:
    - <app-name>.int.${cluster.env}.${cluster.domain}
  http:
    - match:
        - uri:
            prefix: /
      route:
        - destination:
            host: <app-name>
            port:
              number: 80
```

**Deployment (deployment.yaml)** - For non-Helm apps:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: <app-name>
  labels:
    app: <app-name>
spec:
  replicas: 1
  selector:
    matchLabels:
      app: <app-name>
  template:
    metadata:
      labels:
        app: <app-name>
    spec:
      containers:
        - name: <app-name>
          image: ${app.image}
          imagePullPolicy: IfNotPresent
          resources:
            limits:
              cpu: 1000m
              memory: 256Mi
            requests:
              cpu: 100m
              memory: 128Mi
          ports:
            - containerPort: 8080
              name: http
```

**Service (service.yaml):**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: <app-name>
spec:
  selector:
    app: <app-name>
  ports:
    - name: http
      port: 80
      targetPort: 8080
  type: ClusterIP
```

**PersistentVolumeClaim (pvc.yaml)** - For apps needing storage:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: <app-name>
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
```

### 8. Template Variables Reference

Use these template variables in your manifests:

**App Configuration (`app.*`):**
- `${app.enabled}` - Boolean to enable/disable app
- `${app.namespace}` - Target namespace
- `${app.syncWave}` - ArgoCD sync wave
- `${app.version}` - Helm chart version
- `${app.tag}` - Docker image tag
- `${app.image}` - Full image reference
- `${app.values}` - Helm chart value overrides
- `${app.<custom-field>}` - Any custom field from .config file

**Cluster Configuration (`cluster.*`):**
- `${cluster.gitlabProjectUrl}` - Git repository URL
- `${cluster.env}` - Environment name (dev, staging, prod)
- `${cluster.domain}` - Base domain
- `${cluster.domainSuffix}` - Domain suffix
- `${cluster.cc}` - Control center name
- `${cluster.sc}` - Storage cluster name
- `${cluster.cloud_platform}` - Cloud platform type

**Other Apps (`apps.*`):**
- `${apps.<other-app-name>.<field>}` - Access config from other apps

**Conditional templating:**
- `%{ if condition }` ... `%{ endif }` - Conditional blocks
- `%{ for item in list }` ... `%{ endfor }` - Loop blocks

### 9. Environment-Specific Configuration

Users can override addon configuration by creating `custom-config/<app-name>.yaml`:

```yaml
# custom-config/<app-name>.yaml
enabled: true           # Enable the app
namespace: custom-ns    # Override namespace
syncWave: 5            # Override sync wave
version: 2.0.0         # Override chart version
tag: custom-tag        # Override image tag
values:                # Helm chart overrides
  resources:
    limits:
      cpu: 2000m
      memory: 1Gi
```

### 10. Testing the Addon

**Local validation:**

```bash
# Navigate to the addon directory
cd <addon-name>/<app-name>

# Validate kustomization
kustomize build .

# Check for template syntax (if using envsubst or similar)
# Set required variables
export app='{"enabled": true, "namespace": "test", "syncWave": "0", "version": "1.0.0"}'
export cluster='{"gitlabProjectUrl": "https://git.example.com/repo", "env": "dev", "domain": "example.com"}'

# Test ArgoCD application rendering (requires gomplate or similar)
gomplate -f <app-name>.app.yaml
```

**Deployment testing:**

1. Push addon to git repository
2. Enable in environment: Create `custom-config/<app-name>.yaml` with `enabled: true`
3. Sync ArgoCD app-of-apps
4. Monitor deployment: `kubectl get applications -n argocd`
5. Check app status: `kubectl get all -n <namespace>`

## Common Patterns and Examples

### Pattern 1: Simple Helm Chart Deployment

**Use case:** Deploy a standard Helm chart with minimal customization

**Files needed:**
- `.config/<app-name>.yaml`
- `<app-name>.app.yaml`
- `kustomization.yaml`
- `values-default.yaml`
- `values-override.yaml`

**Example:** Headlamp (K8s dashboard)

### Pattern 2: Plain Manifests with ConfigMaps

**Use case:** Deploy application without Helm, using custom manifests

**Files needed:**
- `.config/<app-name>.yaml`
- `<app-name>.app.yaml`
- `kustomization.yaml`
- `deployment.yaml`
- `service.yaml`
- `vs.yaml` (optional)
- Configuration files

**Example:** Cloud Beaver (database UI)

### Pattern 3: CronJob-based Addon

**Use case:** Scheduled jobs for testing or maintenance

**Files needed:**
- `.config/<app-name>.yaml`
- `<app-name>.app.yaml`
- `kustomization.yaml`
- `cronjob.yaml`
- ConfigMaps for job scripts

**Example:** Benchmark MySQL

### Pattern 4: Operator-based Deployment

**Use case:** Deploy operator + custom resources

**Files needed:**
- `.config/<app-name>.yaml`
- `<app-name>.app.yaml`
- `kustomization.yaml` (with Helm chart)
- `values-default.yaml`
- Custom resource definitions (schedules, tests, etc.)

**Example:** Chaos Mesh, K6 Operator

## Best Practices

1. **Naming Conventions:**
   - Use lowercase with hyphens
   - Keep names concise but descriptive
   - Match the tool's common name when possible

2. **Configuration:**
   - Set sensible defaults in `.config/<app-name>.yaml`
   - Document all configuration options
   - Use template variables for environment-specific values

3. **Resource Limits:**
   - Always set resource requests and limits
   - Start conservative, tune based on actual usage
   - Document expected resource usage

4. **Security:**
   - Never hardcode secrets
   - Use ExternalSecrets or Vault integration
   - Follow principle of least privilege for RBAC

5. **Documentation:**
   - Add README.md to addon directory if complex
   - Document configuration options
   - Include usage examples

6. **Sync Waves:**
   - Use negative waves (-1, -2) for infrastructure dependencies
   - Use 0 for standard applications
   - Use high values (99+) for tests and post-deployment tasks

7. **Virtual Services:**
   - Use internal gateway for admin/development tools
   - Follow domain naming convention: `<app>.int.<env>.<domain>`
   - Add appropriate security headers

8. **Helm Values:**
   - Keep `values-default.yaml` minimal
   - Use template variables for dynamic values
   - Let `values-override.yaml` be environment-specific

9. **Testing:**
   - Test locally with kustomize build
   - Deploy to dev environment first
   - Validate all template variables resolve correctly

10. **Version Control:**
    - Commit all files including empty values-override.yaml
    - Use descriptive commit messages
    - Tag stable versions for reuse

## Troubleshooting

**App not appearing in ArgoCD:**
- Verify `.app.yaml` has correct path
- Check `app.enabled` is true in config
- Confirm ArgoCD has synced the app-of-apps

**Template variables not resolving:**
- Verify variable names match config structure
- Check for typos in `${...}` references
- Ensure config files are in correct location

**Helm chart not found:**
- Verify chart repository URL is correct
- Check chart name and version exist
- Ensure network access to chart repository

**Namespace issues:**
- Verify namespace in `.app.yaml` matches config
- Check `CreateNamespace=true` in syncOptions
- Ensure namespace doesn't conflict with existing resources

**Sync failures:**
- Check ArgoCD application status
- Review K8s events in target namespace
- Verify all referenced secrets/configmaps exist

## Examples Directory

Refer to existing addons for working examples. **Note:** Some addons use the old structure - do NOT replicate that pattern.

**Addons using the NEW structure (correct to reference):**
- Look for addons with `.config/` directory and `<app-name>.app.yaml` at the root
- These follow the correct pattern for new addons

**Addons using the OLD structure (do NOT replicate):**
- Addons with configuration only in `default.yaml`
- Addons with app definitions in `app-yamls/` directory
- These exist for backward compatibility only

## Common Mistakes to Avoid

### ❌ DO NOT:

1. **Create app definition files in `app-yamls/` directory**
   ```bash
   # WRONG - do not do this:
   app-yamls/my-new-app.yaml
   ```

2. **Add configuration to `default.yaml`**
   ```yaml
   # WRONG - do not add to default.yaml:
   my-new-app:
       image: my-image:latest
       ...
   ```

3. **Use old template variable patterns**
   ```yaml
   # WRONG - old structure pattern:
   image: ${my-app.image}
   ```

### ✅ DO:

1. **Create app definition in the app's own directory**
   ```bash
   # CORRECT:
   <app-name>/<app-name>.app.yaml
   ```

2. **Put configuration in `.config/<app-name>.yaml`**
   ```yaml
   # CORRECT - in .config/<app-name>.yaml:
   enabled: true
   image: my-image:latest
   namespace: my-app
   syncWave: 0
   ```

3. **Use `${app.*}` template variables**
   ```yaml
   # CORRECT - references .config/<app-name>.yaml:
   image: ${app.image}
   namespace: ${app.namespace}
   ```

4. **Make the addon self-contained**
   - All configuration in `.config/` directory
   - All manifests in the app directory
   - App definition at the root of the app directory

## Structure Comparison

### NEW Structure (Use This) ✅

```
mongo-express/
├── .config/
│   └── mongo-express.yaml       # Configuration here
├── mongo-express.app.yaml       # App definition here
├── kustomization.yaml
├── deployment.yaml
├── service.yaml
├── vs.yaml
└── README.md
```

**Template variables:** `${app.image}`, `${app.mongoUrl}`, etc.

### OLD Structure (Don't Use) ❌

```
app-yamls/
└── mongo-express.yaml           # App definition (OLD location)
default.yaml                     # Configuration (OLD location)
mongo-express/
├── kustomization.yaml
├── deployment.yaml
└── service.yaml
```

**Template variables:** `${mongo-express.image}` (OLD pattern)

## References

- ArgoCD Documentation: https://argo-cd.readthedocs.io/
- Kustomize Documentation: https://kustomize.io/
- Helm Documentation: https://helm.sh/docs/
- Mojaloop IAC Modules Addon Spec: [addons.md](https://github.com/mojaloop/iac-modules/blob/feature/storage-cluster/docs/addons.md)
