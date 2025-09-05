# Build Raptor - AI Assistant Guide

## Project Overview

Build Raptor is a high-performance, cache-optimized monorepo build system for TypeScript/JavaScript projects. It dramatically reduces build times through intelligent caching, parallel execution, and dependency tracking. The system only rebuilds what has changed, caching everything else using content-addressable storage.

**Core Philosophy**: "Only rebuild what has changed - cache everything else"

## Critical System Context

### Repository Structure

```
build-raptor/
├── modules/                    # Core modules directory
│   ├── build-raptor/           # Main CLI entry point
│   ├── build-raptor-core/      # Core engine and orchestration
│   ├── yarn-repo-protocol/     # Yarn workspace implementation
│   ├── s3-storage-client/      # S3 caching backend
│   ├── misc/                   # Shared utilities
│   └── [other modules]         # Supporting functionality
├── docs/                       # Architecture documentation
├── .build-raptor.json         # Build configuration
└── package.json               # Workspace root
```

### Technology Stack

- **Language**: TypeScript 4.5+
- **Runtime**: Node.js
- **Package Manager**: Yarn Workspaces
- **Testing**: Jest
- **Storage**: AWS S3 + Local filesystem
- **Build Tool**: Build Raptor (self-hosted)

## Core Concepts You Must Understand

### 1. Task Graph Model

- Build operations are modeled as a DAG (Directed Acyclic Graph)
- Tasks have:
  - **inputs**: Files or other task outputs
  - **outputs**: Files produced
  - **labels**: For selective execution
  - **fingerprints**: SHA256 hash of inputs for caching
- Task naming: `${unitId}:${taskKind}` (e.g., `build-raptor:test`)

### 2. Content-Addressable Caching

- Every task gets a fingerprint based on input contents (not timestamps)
- Cache storage: S3 bucket or local `.build-raptor/cache/`
- Cache hit = skip execution, restore outputs from cache
- Tight fingerprints mode: Only hash direct inputs, not transitive

### 3. Repository Protocols

- Abstraction layer for different monorepo tools
- Current implementation: Yarn workspaces
- Extensible to npm, pnpm, rush, etc.
- Protocol discovers packages and extracts build tasks from `package.json`

### 4. Step-by-Step Reporting

- Real-time build events in JSON format
- External processors can consume events
- Used for monitoring, debugging, and integration

## Development Guidelines

### Code Style & Patterns

#### ALWAYS Follow These Patterns:

1. **Immutable Task State**

```typescript
// ❌ WRONG - Never mutate tasks
task.inputs.push(newInput)

// ✅ CORRECT - Create new task
const newTask = new Task({ ...task, inputs: [...task.inputs, newInput] })
```

2. **Error Handling**

```typescript
// Always wrap async operations
try {
  await taskStore.put(task, outputs)
} catch (error) {
  logger.error(`Cache write failed: ${error}`)
  // Continue without cache - don't fail build
}
```

3. **Resource Cleanup**

```typescript
// Use finally blocks for cleanup
const handle = await acquireResource()
try {
  await useResource(handle)
} finally {
  await releaseResource(handle)
}
```

4. **Event Emission**

```typescript
// Emit events at state transitions
task.setPhase('EXECUTING')
transmitter.emit({ step: 'TASK_STARTED', taskName: task.name })
```

#### Code Conventions:

- Use existing utilities from `misc` module
- Follow existing file naming patterns
- Preserve TypeScript strict mode
- No console.log - use Logger service
- Test files use `.spec.ts` suffix
- Integration tests use `.e2e.spec.ts` suffix

### Testing Requirements

#### Test Organization:

- Unit tests: In `tests/` directory of each module
- Use Jest with configuration from `jest.config.js`
- Test utilities available in `build-raptor-core-testkit`

#### Running Tests:

```bash
# Run all tests (self-build)
yarn test

# Run specific module tests
yarn workspace build-raptor test

# Run with coverage
yarn test --coverage
```

#### Test Patterns:

- Use `Driver` class from testkit for integration tests
- Mock storage clients for unit tests
- Test both cache hit and cache miss scenarios

### Build & Development Commands

```bash
# Initial build
yarn build

# Self-build (builds itself using build-raptor)
yarn self-build

# Lint check
yarn lint

# Format code
yarn prettier --write .

# Pack all modules
yarn pack-all

# Publish assets to S3
yarn publish-assets
```

### Configuration

#### `.build-raptor.json` Schema:

```json
{
  "verbosePrintTasks": [], // Task names for detailed output
  "tightFingerprints": true, // Only hash direct inputs
  "outDirName": ".out", // Output directory name
  "repoProtocol": {
    // Protocol-specific config
    "install": "dormant" // Install strategy
  }
}
```

#### Environment Variables:

- `BUILD_RAPTOR_S3_BUCKET`: S3 bucket for cache
- `AWS_REGION`: AWS region (default: us-east-1)
- `BUILD_RAPTOR_CACHE_DIR`: Local cache directory

## Critical Files & Their Purposes

### Core Engine Files:

- `modules/build-raptor-core/src/engine.ts`: Main orchestration engine
- `modules/build-raptor-core/src/planner.ts`: Task graph builder
- `modules/build-raptor-core/src/task-executor.ts`: Task execution manager
- `modules/build-raptor-core/src/fingerprinter.ts`: Change detection
- `modules/build-raptor-core/src/task-store.ts`: Cache management

### CLI & API:

- `modules/build-raptor/src/build-raptor-cli.ts`: CLI interface
- `modules/build-raptor-api/src/build-raptor-api.ts`: Event schema definitions

### Protocol Implementation:

- `modules/yarn-repo-protocol/src/yarn-repo-protocol.ts`: Yarn workspace handler
- `modules/repo-protocol/src/repo-protocol.ts`: Abstract protocol interface

## Common Tasks & Solutions

### Adding a New Build Task

1. **In package.json**:

```json
{
  "scripts": {
    "my-task": "node my-script.js"
  },
  "buildTasks": {
    "my-task": {
      "inputs": ["src/**/*.ts"],
      "outputs": ["dist/output.js"],
      "labels": ["custom"],
      "publicOutputs": ["dist/public.js"]
    }
  }
}
```

2. **Special task types**:

- Always-run task: Set `inputs: "_ALWAYS_"`
- No-cache task: Omit outputs definition

### Debugging Build Issues

1. **Check logs**:

   - Main log: `.build-raptor/main.log`
   - Task outputs: `.build-raptor/tasks/${taskName}.out`

2. **Enable verbose output**:

   - Add task names to `verbosePrintTasks` in config
   - Use `--task-progress-output` flag

3. **Force rebuild**:
   - Delete `.build-raptor/cache/` directory
   - Clear S3 cache if needed

### Extending Repository Protocol

1. Create new protocol class:

```typescript
export class MyProtocol extends RepoProtocol {
  async scan(): Promise<Unit[]> {
    /* ... */
  }
  getTaskInfos(unit: Unit): TaskInfo[] {
    /* ... */
  }
  async install(): Promise<void> {
    /* ... */
  }
}
```

2. Register in engine bootstrapper
3. Add configuration schema

## Architecture Invariants (Never Violate)

1. **Deterministic Builds**: Same inputs MUST produce same outputs
2. **Task Isolation**: Tasks cannot affect each other except through declared dependencies
3. **DAG Property**: No circular dependencies allowed
4. **Cache Consistency**: Fingerprint uniquely identifies task outputs
5. **File-Based I/O**: All inputs/outputs must be files (not in-memory)

## Performance Optimization Tips

1. **Use Tight Fingerprints**: Set `tightFingerprints: true` in config
2. **Minimize Task Granularity**: Fewer, larger tasks often perform better
3. **Local Cache First**: Configure local cache to reduce S3 calls
4. **Parallel Execution**: Ensure wide task graph for maximum parallelism
5. **Public Outputs**: Only mark truly needed outputs as public

## Error Recovery Mechanisms

### Build Failures:

- Partial builds continue on independent branches
- Failed task outputs are not cached
- Detailed error logs in `.build-raptor/tasks/`

### Cache Failures:

- Automatic fallback: S3 → Local → Rebuild
- Corrupt cache entries are auto-invalidated
- Network failures trigger exponential backoff

### System Failures:

- OOM: Graceful task termination
- Disk full: Build pauses with clear error
- Process crashes: Cleanup and detailed logs

## Integration Points

### Step-by-Step Processor:

```typescript
// Custom processor example
export const processor: StepByStepProcessor = (step: Step) => {
  if (step.step === 'TASK_ENDED' && step.verdict === 'FAIL') {
    // Handle failed task
    notifyBuildSystem(step.taskName)
  }
}
```

### CI/CD Integration:

- Use `--ci` flag for CI-appropriate output
- Export `BUILD_RAPTOR_S3_BUCKET` for shared cache
- Monitor step-by-step JSON for build status

## Module Dependencies Graph

```
build-raptor → build-raptor-core → fingerprinter
            ↓                    ↓
    yarn-repo-protocol      task-store
            ↓                    ↓
      repo-protocol       s3-storage-client
            ↓                    ↓
         misc ← ← ← ← ← ← ← ← ← ↓
```

## Security Considerations

1. **Never commit AWS credentials** - Use IAM roles or env vars
2. **Cache isolation** - Each repo has separate namespace
3. **No code execution from cache** - Only build outputs stored
4. **Checksum validation** - SHA256 verification on all cache entries

## Troubleshooting Quick Reference

| Issue                 | Solution                                     |
| --------------------- | -------------------------------------------- |
| Build not using cache | Check fingerprints, verify S3 access         |
| Task always rebuilds  | Check `_ALWAYS_` flag, verify inputs list    |
| Slow builds           | Enable tight fingerprints, check parallelism |
| Cache corruption      | Delete local cache, invalidate S3 entries    |
| Memory issues         | Reduce parallel execution limit              |
| Network timeouts      | Configure retry settings, check AWS config   |

## Getting Help

- Architecture docs: `docs/ARCHITECTURE_OVERVIEW.md`
- Subsystems guide: `docs/CORE_SUBSYSTEMS_GUIDE.md`
- Module reference: `docs/MODULE_REFERENCE_CATALOG.md`
- Source code: Well-documented TypeScript with JSDoc comments

## Final Notes for AI Assistants

When working with this codebase:

1. **Preserve existing patterns** - Don't introduce new paradigms
2. **Test everything** - Use the comprehensive test suite
3. **Check dependencies** - Module boundaries are strict
4. **Use type safety** - TypeScript strict mode is enforced
5. **Document changes** - Update relevant documentation
6. **Performance matters** - This is a build system, speed is critical

Remember: Build Raptor builds itself. Any changes must maintain this self-hosting capability.
