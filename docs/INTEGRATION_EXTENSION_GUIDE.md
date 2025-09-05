# Build Raptor - Integration & Extension Guide

## Quick Start Integration

### 1. Basic Setup

```bash
# Install build-raptor in your monorepo
npm install --save-dev build-raptor

# Create configuration file
cat > .build-raptor.json << 'EOF'
{
  "verbosePrintTasks": [],
  "tightFingerprints": true,
  "repoProtocol": {
    "install": "full"
  }
}
EOF

# Run your first build
npx build-raptor build
```

### 2. Defining Build Tasks

Add to your `package.json`:

```json
{
  "name": "my-module",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "lint": "eslint src"
  },
  "buildTasks": {
    "build": {
      "inputs": ["src/**/*.ts", "tsconfig.json"],
      "outputs": ["dist/**/*.js", "dist/**/*.d.ts"],
      "labels": ["compile"]
    },
    "test": {
      "inputs": ["dist/**/*.js", "tests/**/*.spec.ts"],
      "outputs": ["coverage/**"],
      "labels": ["test", "ci"]
    },
    "lint": {
      "inputs": ["src/**/*.ts", ".eslintrc"],
      "outputs": "_ALWAYS_",
      "labels": ["lint", "ci"]
    }
  }
}
```

### 3. S3 Cache Setup

```bash
# Set AWS credentials (using AWS SDK credential chain)
export AWS_PROFILE=my-profile
# OR
export AWS_ACCESS_KEY_ID=xxx
export AWS_SECRET_ACCESS_KEY=yyy

# Configure S3 bucket
export BUILD_RAPTOR_S3_BUCKET=my-build-cache-bucket
export AWS_REGION=us-east-1

# Enable S3 caching
npx build-raptor build --storage=s3
```

---

## Extension Points

### 1. Custom Repository Protocol

Create a new protocol to support different package managers:

```typescript
// my-repo-protocol.ts
import { RepoProtocol, Unit, TaskInfo } from 'repo-protocol'
import { PathInRepo, UnitId } from 'core-types'

export class MyRepoProtocol extends RepoProtocol {
  async scan(): Promise<Unit[]> {
    // Discover packages in your monorepo structure
    const packages = await this.findPackages()

    return packages.map(pkg => ({
      id: UnitId(pkg.name),
      pathInRepo: PathInRepo(pkg.path),
      dependencies: this.extractDependencies(pkg),
    }))
  }

  getTaskInfos(unit: Unit): TaskInfo[] {
    // Extract build tasks from your package format
    const config = this.readPackageConfig(unit.pathInRepo)

    return Object.entries(config.tasks).map(([name, task]) => ({
      taskName: TaskName().make(unit.id, name),
      command: task.command,
      env: task.env,
      outputLocations: task.outputs.map(o => ({
        pathInRepo: PathInRepo(o),
        isPublic: task.public || false,
      })),
    }))
  }

  async install(): Promise<void> {
    // Install dependencies for your package manager
    await this.runCommand('my-package-manager install')
  }

  private async findPackages(): Promise<Package[]> {
    // Your package discovery logic
  }

  private extractDependencies(pkg: Package): UnitId[] {
    // Your dependency extraction logic
  }
}
```

### 2. Step-by-Step Processor

Monitor and react to build events in real-time:

```typescript
// build-monitor.ts
import { Step, StepByStepProcessor } from 'build-raptor-api'

interface BuildMetrics {
  totalTasks: number
  executedTasks: number
  cachedTasks: number
  failedTasks: number
  duration: number
}

class BuildMonitor {
  private metrics: BuildMetrics = {
    totalTasks: 0,
    executedTasks: 0,
    cachedTasks: 0,
    failedTasks: 0,
    duration: 0,
  }

  private startTime: number = 0

  processStep(step: Step): void {
    switch (step.step) {
      case 'BUILD_RUN_STARTED':
        this.startTime = Date.now()
        console.log(`Build ${step.buildRunId} started`)
        break

      case 'PLAN_PREPARED':
        this.metrics.totalTasks = step.taskNames.length
        console.log(`Planning complete: ${step.taskNames.length} tasks`)
        break

      case 'TASK_ENDED':
        this.updateTaskMetrics(step)
        this.reportProgress()
        break

      case 'BUILD_RUN_ENDED':
        this.metrics.duration = Date.now() - this.startTime
        this.reportFinalMetrics()
        break

      case 'TEST_ENDED':
        if (step.verdict === 'TEST_FAILED') {
          console.error(`Test failed: ${step.testPath.join(' > ')}`)
        }
        break

      case 'ASSET_PUBLISHED':
        console.log(`Asset published: ${step.file} -> ${step.casAddress}`)
        break
    }
  }

  private updateTaskMetrics(step: Extract<Step, { step: 'TASK_ENDED' }>) {
    if (step.executionType === 'EXECUTED') {
      this.metrics.executedTasks++
    } else if (step.executionType === 'CACHED') {
      this.metrics.cachedTasks++
    }

    if (step.verdict === 'FAIL' || step.verdict === 'CRASH') {
      this.metrics.failedTasks++
    }
  }

  private reportProgress() {
    const completed = this.metrics.executedTasks + this.metrics.cachedTasks
    const percentage = Math.round((completed / this.metrics.totalTasks) * 100)
    console.log(`Progress: ${percentage}% (${completed}/${this.metrics.totalTasks})`)
  }

  private reportFinalMetrics() {
    console.log('Build Complete!')
    console.log(`  Total Tasks: ${this.metrics.totalTasks}`)
    console.log(`  Executed: ${this.metrics.executedTasks}`)
    console.log(`  Cached: ${this.metrics.cachedTasks}`)
    console.log(`  Failed: ${this.metrics.failedTasks}`)
    console.log(`  Duration: ${this.metrics.duration}ms`)
    console.log(`  Cache Hit Rate: ${Math.round((this.metrics.cachedTasks / this.metrics.totalTasks) * 100)}%`)
  }
}

// Export for build-raptor to use
const monitor = new BuildMonitor()
export const processor: StepByStepProcessor = step => {
  monitor.processStep(step)
}
```

Usage:

```bash
npx build-raptor build --step-by-step-processor=./build-monitor.js
```

### 3. Custom Asset Publisher

Publish build artifacts to custom locations:

```typescript
// custom-publisher.ts
import { AssetPublisher } from 'build-raptor-core'
import { Task } from 'build-raptor-core'

export class CustomAssetPublisher implements AssetPublisher {
  async publish(task: Task, files: string[]): Promise<void> {
    for (const file of files) {
      const content = await fs.readFile(file)
      const hash = computeHash(content)

      // Upload to your CDN
      await this.uploadToCDN(hash, content)

      // Update manifest
      await this.updateManifest(task.name, file, hash)

      // Emit custom event
      this.emit('ASSET_PUBLISHED', {
        task: task.name,
        file,
        url: `https://cdn.example.com/${hash}`,
      })
    }
  }

  private async uploadToCDN(hash: string, content: Buffer) {
    // Your CDN upload logic
  }

  private async updateManifest(taskName: string, file: string, hash: string) {
    // Your manifest update logic
  }
}
```

---

## Test Scenarios

### Scenario 1: Testing Cache Behavior

```typescript
// test/cache-behavior.spec.ts
import { TestDriver } from 'build-raptor-core-testkit'

describe('Cache Behavior', () => {
  let driver: TestDriver

  beforeEach(async () => {
    driver = new TestDriver()
    await driver.setupRepo({
      'package.json': {
        workspaces: ['packages/*'],
      },
      'packages/lib/package.json': {
        name: 'lib',
        buildTasks: {
          build: {
            inputs: ['src/index.ts'],
            outputs: ['dist/index.js'],
          },
        },
      },
      'packages/lib/src/index.ts': 'export const value = 42;',
    })
  })

  test('should cache task outputs', async () => {
    // First build - task executes
    const result1 = await driver.runBuild()
    expect(result1.executedTasks).toContain('lib:build')
    expect(result1.cachedTasks).toEqual([])

    // Second build - task cached
    const result2 = await driver.runBuild()
    expect(result2.executedTasks).toEqual([])
    expect(result2.cachedTasks).toContain('lib:build')
  })

  test('should invalidate cache on input change', async () => {
    // First build
    await driver.runBuild()

    // Modify input
    await driver.modifyFile('packages/lib/src/index.ts', 'export const value = 100;')

    // Second build - task re-executes
    const result = await driver.runBuild()
    expect(result.executedTasks).toContain('lib:build')
  })

  test('should propagate cache invalidation', async () => {
    await driver.setupRepo({
      'packages/app/package.json': {
        name: 'app',
        dependencies: { lib: '*' },
        buildTasks: {
          build: {
            inputs: ['src/index.ts', '../lib/dist/index.js'],
            outputs: ['dist/app.js'],
          },
        },
      },
    })

    // First build
    await driver.runBuild()

    // Modify lib
    await driver.modifyFile('packages/lib/src/index.ts', 'export const value = 200;')

    // Both lib and app should rebuild
    const result = await driver.runBuild()
    expect(result.executedTasks).toContain('lib:build')
    expect(result.executedTasks).toContain('app:build')
  })
})
```

### Scenario 2: Testing Parallel Execution

```typescript
// test/parallel-execution.spec.ts
describe('Parallel Execution', () => {
  test('should execute independent tasks in parallel', async () => {
    await driver.setupRepo({
      'packages/a/package.json': createPackage('a'),
      'packages/b/package.json': createPackage('b'),
      'packages/c/package.json': createPackage('c'),
    })

    const result = await driver.runBuild()

    // Check execution waves
    expect(result.executionWaves).toEqual([
      ['a:build', 'b:build', 'c:build'], // All in same wave
    ])
  })

  test('should respect dependencies', async () => {
    await driver.setupRepo({
      'packages/core/package.json': createPackage('core'),
      'packages/ui/package.json': createPackage('ui', ['core']),
      'packages/app/package.json': createPackage('app', ['core', 'ui']),
    })

    const result = await driver.runBuild()

    expect(result.executionWaves).toEqual([
      ['core:build'], // Wave 1
      ['ui:build'], // Wave 2
      ['app:build'], // Wave 3
    ])
  })
})
```

### Scenario 3: Testing Failure Handling

```typescript
// test/failure-handling.spec.ts
describe('Failure Handling', () => {
  test('should stop dependent tasks on failure', async () => {
    await driver.setupRepo({
      'packages/failing/package.json': {
        name: 'failing',
        scripts: {
          build: 'exit 1', // Will fail
        },
        buildTasks: {
          build: {
            inputs: [],
            outputs: ['dist/index.js'],
          },
        },
      },
      'packages/dependent/package.json': {
        name: 'dependent',
        dependencies: { failing: '*' },
        buildTasks: {
          build: {
            inputs: ['../failing/dist/index.js'],
            outputs: ['dist/app.js'],
          },
        },
      },
    })

    const result = await driver.runBuild()

    expect(result.failedTasks).toContain('failing:build')
    expect(result.skippedTasks).toContain('dependent:build')
    expect(result.exitCode).toBe(1)
  })

  test('should continue independent tasks on failure', async () => {
    await driver.setupRepo({
      'packages/failing/package.json': createFailingPackage('failing'),
      'packages/independent/package.json': createPackage('independent'),
    })

    const result = await driver.runBuild({ continueOnFailure: true })

    expect(result.failedTasks).toContain('failing:build')
    expect(result.executedTasks).toContain('independent:build')
  })
})
```

### Scenario 4: Testing Label-Based Selection

```typescript
// test/label-selection.spec.ts
describe('Label-Based Selection', () => {
  test('should run only tasks with specified labels', async () => {
    await driver.setupRepo({
      'packages/lib/package.json': {
        name: 'lib',
        buildTasks: {
          build: {
            inputs: ['src/**/*.ts'],
            outputs: ['dist/**/*.js'],
            labels: ['compile'],
          },
          test: {
            inputs: ['dist/**/*.js'],
            outputs: [],
            labels: ['test', 'ci'],
          },
          lint: {
            inputs: ['src/**/*.ts'],
            outputs: [],
            labels: ['lint', 'ci'],
          },
        },
      },
    })

    // Run only CI tasks
    const result = await driver.runBuild({
      labels: ['ci'],
    })

    expect(result.executedTasks).toContain('lib:test')
    expect(result.executedTasks).toContain('lib:lint')
    expect(result.executedTasks).not.toContain('lib:build')
  })
})
```

---

## Migration Guide

### From Nx

```javascript
// nx.json -> .build-raptor.json
{
  // Nx
  "tasksRunnerOptions": {
    "default": {
      "runner": "@nrwl/workspace/tasks-runners/default",
      "options": {
        "cacheableOperations": ["build", "test"]
      }
    }
  }

  // Build Raptor
  "repoProtocol": {
    "install": "full"
  }
}

// project.json -> package.json
{
  // Add buildTasks section
  "buildTasks": {
    "build": {
      "inputs": ["src/**/*.ts"],
      "outputs": ["dist/**/*"]
    }
  }
}
```

### From Lerna

```javascript
// lerna.json -> .build-raptor.json
{
  // Lerna
  "command": {
    "run": {
      "stream": true
    }
  }

  // Build Raptor (automatic streaming)
  "verbosePrintTasks": ["*"]
}

// No changes needed in package.json
// Just add buildTasks section
```

### From Rush

```javascript
// rush.json -> .build-raptor.json
{
  // Rush
  "buildCacheEnabled": true,
  "cacheProvider": "azure-blob-storage"

  // Build Raptor
  // Set S3 environment variables instead
}

// package.json changes
{
  // Add buildTasks for each rush command
  "buildTasks": {
    "build": {
      "inputs": ["src/**/*"],
      "outputs": ["lib/**/*"]
    }
  }
}
```

---

## Performance Tuning

### 1. Optimize Task Granularity

```json
// ❌ Too coarse - poor parallelism
{
  "buildTasks": {
    "all": {
      "inputs": ["**/*"],
      "outputs": ["dist/**/*", "coverage/**/*"]
    }
  }
}

// ✅ Better - allows parallel execution
{
  "buildTasks": {
    "compile": {
      "inputs": ["src/**/*.ts"],
      "outputs": ["dist/**/*.js"]
    },
    "test": {
      "inputs": ["dist/**/*.js", "tests/**/*.spec.ts"],
      "outputs": ["coverage/**/*"]
    },
    "lint": {
      "inputs": ["src/**/*.ts"],
      "outputs": "_ALWAYS_"
    }
  }
}
```

### 2. Configure Concurrency

```json
// .build-raptor.json
{
  "maxConcurrency": 4, // Limit parallel tasks
  "memoryLimit": "2GB", // Per-task memory limit
  "timeout": 300000 // 5 minute timeout
}
```

### 3. Enable Tight Fingerprints

```json
{
  "tightFingerprints": true // Only hash direct inputs
}
```

### 4. Use Local Cache

```bash
# Configure local cache size
export BUILD_RAPTOR_LOCAL_CACHE_SIZE=10GB

# Use local cache as primary
npx build-raptor build --storage=local --fallback-storage=s3
```

---

## Troubleshooting

### Debug Mode

```bash
# Enable verbose logging
npx build-raptor build --verbose

# Trace task execution
npx build-raptor build --trace

# Print specific task output
npx build-raptor build --verbose-print-tasks=my-module:build
```

### Common Issues

**Issue**: Cache misses when expected hits

```bash
# Check fingerprint calculation
npx build-raptor build --explain-fingerprints

# Verify inputs haven't changed
npx build-raptor build --verify-cache
```

**Issue**: Tasks not running in parallel

```bash
# Check dependency graph
npx build-raptor build --print-graph

# Verify no artificial dependencies
npx build-raptor build --analyze-parallelism
```

**Issue**: S3 cache not working

```bash
# Test S3 connectivity
npx build-raptor test-storage

# Check credentials
aws s3 ls s3://$BUILD_RAPTOR_S3_BUCKET/
```

---

## Best Practices

### 1. Task Definition

- Keep tasks focused and single-purpose
- Declare all inputs explicitly
- Use globs carefully to avoid over-matching
- Prefer relative paths in inputs/outputs

### 2. Cache Optimization

- Use S3 for team sharing
- Configure local cache for development
- Regular cache cleanup for local development
- Monitor cache hit rates

### 3. CI/CD Integration

```yaml
# GitHub Actions example
- name: Setup Build Cache
  env:
    BUILD_RAPTOR_S3_BUCKET: ${{ secrets.CACHE_BUCKET }}
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

- name: Build
  run: npx build-raptor build --labels=ci

- name: Upload Metrics
  if: always()
  run: npx build-raptor report --format=json > metrics.json
```

### 4. Monitoring

- Use step-by-step processors for real-time monitoring
- Track cache hit rates over time
- Monitor build duration trends
- Alert on build failures

---

_This guide provides comprehensive integration scenarios and extension examples. For architectural details, refer to the System Architecture Overview._
