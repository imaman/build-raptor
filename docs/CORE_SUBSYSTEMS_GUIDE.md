# Build Raptor - Core Subsystems Guide

## 1. Task Orchestration Engine

### Overview

The task orchestration engine is the heart of Build Raptor, responsible for planning, scheduling, and executing build tasks in the correct order while maximizing parallelism.

### Key Components

#### Engine (Primary Orchestrator)

**Location**: `modules/build-raptor-core/src/engine.ts:40-250`

**Responsibilities**:

- Coordinates entire build lifecycle
- Manages task execution flow
- Handles cache interactions
- Emits lifecycle events

**Key Methods**:

```typescript
async run(): Promise<Breakdown>  // Main entry point - lines 95-150
async planAndRun(): Promise<void>  // Planning + execution - lines 160-220
```

**Invariants**:

- Tasks execute only after dependencies complete
- Cache checks occur before execution
- Failed tasks propagate failure to dependents

#### Planner (Graph Builder)

**Location**: `modules/build-raptor-core/src/planner.ts:20-180`

**Responsibilities**:

- Constructs task DAG from repository structure
- Performs topological sorting
- Identifies execution waves (parallel groups)

**Critical Algorithm** (lines 45-89):

```typescript
// Topological sort with wave detection
computeWaves(): Wave[] {
  // Groups tasks into waves where each wave contains
  // tasks that can execute in parallel
}
```

**Data Structures**:

- `TaskGraph`: Adjacency list representation
- `Wave`: Array of parallelizable tasks
- `TaskNode`: Task metadata + edges

#### Task Executor (Execution Manager)

**Location**: `modules/build-raptor-core/src/task-executor.ts:15-200`

**Responsibilities**:

- Spawns task processes
- Manages execution slots
- Captures output streams
- Handles timeouts/crashes

**Execution Flow** (lines 50-120):

```typescript
async execute(task: Task): Promise<ExecutionResult> {
  // 1. Prepare execution environment
  // 2. Spawn child process
  // 3. Stream outputs to files
  // 4. Wait for completion/timeout
  // 5. Return verdict
}
```

**Resource Management**:

- Process pool with configurable concurrency
- Memory monitoring per task
- Automatic cleanup on failure

### Anti-Patterns to Avoid

❌ **Don't**: Modify task graph during execution
❌ **Don't**: Execute tasks without fingerprinting
❌ **Don't**: Ignore task failure propagation
✅ **Do**: Always check cache before execution
✅ **Do**: Preserve task isolation

---

## 2. Fingerprinting & Caching Mechanism

### Overview

The caching system ensures builds are fast by skipping unnecessary work. It uses content-based fingerprinting to detect changes.

### Key Components

#### Fingerprinter (Change Detection)

**Location**: `modules/build-raptor-core/src/fingerprinter.ts:25-150`

**Core Algorithm** (lines 40-75):

```typescript
computeFingerprint(task: Task): Fingerprint {
  // 1. Hash input file contents
  // 2. Hash task configuration
  // 3. Include dependency fingerprints
  // 4. Generate SHA256 digest
}
```

**Fingerprint Composition**:

```yaml
Fingerprint = SHA256(
+ Input file hashes (sorted)
+ Task command hash
+ Task env vars hash
+ Dependency fingerprints (sorted)
)
```

**Optimization**: "Tight fingerprints" mode (lines 85-95)

- Only hashes direct inputs, not transitive
- Reduces computation time
- Maintains correctness via dependency chain

#### Task Store (Cache Manager)

**Location**: `modules/build-raptor-core/src/task-store.ts:30-250`

**Cache Operations**:

**PUT Operation** (lines 60-110):

```typescript
async put(task: Task, outputs: string[]): Promise<void> {
  // 1. Create tar archive of outputs
  // 2. Compute content hash
  // 3. Upload to S3 with fingerprint key
  // 4. Update local cache index
}
```

**GET Operation** (lines 120-180):

```typescript
async get(fingerprint: Fingerprint): Promise<CacheHit | null> {
  // 1. Check local cache
  // 2. Fallback to S3
  // 3. Download and extract
  // 4. Verify integrity
}
```

**Storage Layout**:

```
S3_BUCKET/
  build-raptor/
    cache/
      ${fingerprint}/
        outputs.tar.gz
        metadata.json
    assets/
      ${hash}/
        file.content
```

#### Cache Invalidation Strategy

**Location**: `modules/build-raptor-core/src/cache-invalidator.ts:15-80`

**Invalidation Triggers**:

1. Source file modification
2. Task configuration change
3. Dependency output change
4. Build tool version change

**Cache Coherence Protocol**:

- Write-through to S3
- Read-through from local
- Eventual consistency model
- No cache expiration (content-addressed)

### Performance Characteristics

- **Cache Hit Latency**: ~10ms local, ~100ms S3
- **Cache Size**: Unbounded (content-addressed)
- **Compression**: Gzip for tar archives
- **Deduplication**: Automatic via content addressing

---

## 3. Repository Protocol System

### Overview

Repository protocols abstract over different monorepo tools, allowing Build Raptor to work with various package managers.

### Key Components

#### Protocol Interface

**Location**: `modules/repo-protocol/src/repo-protocol.ts:20-100`

**Abstract Methods**:

```typescript
abstract class RepoProtocol {
  abstract scan(): Promise<Unit[]> // Discover packages
  abstract getTaskInfos(unit: Unit): TaskInfo[] // Extract tasks
  abstract install(): Promise<void> // Install dependencies
}
```

#### Yarn Protocol Implementation

**Location**: `modules/yarn-repo-protocol/src/yarn-repo-protocol.ts:40-400`

**Package Discovery** (lines 50-120):

```typescript
async scan(): Promise<Unit[]> {
  // 1. Find workspace root
  // 2. Parse package.json files
  // 3. Resolve workspace globs
  // 4. Build dependency graph
}
```

**Task Extraction** (lines 150-250):

```typescript
getTaskInfos(unit: Unit): TaskInfo[] {
  // Read from package.json:
  // - scripts -> commands
  // - buildTasks -> task definitions
  // - dependencies -> inputs
}
```

**Task Definition Schema**:

```json
{
  "buildTasks": {
    "taskName": {
      "inputs": ["file1", "file2"],
      "outputs": ["dist/output.js"],
      "labels": ["test", "slow"],
      "publicOutputs": ["dist/public.js"]
    }
  }
}
```

### Protocol Extension Points

1. **Custom Commands**: Via `scripts` in package.json
2. **Task Dependencies**: Via `inputs` array
3. **Output Publishing**: Via `publicOutputs`
4. **Selective Execution**: Via `labels`

---

## 4. Storage Layer

### Overview

Provides abstraction over storage backends for caching and asset management.

### Key Components

#### Storage Client Interface

**Location**: `modules/misc/src/storage-client.ts:10-50`

```typescript
interface StorageClient {
  put(key: Key, content: Buffer): Promise<void>
  get(key: Key): Promise<Buffer | null>
  list(prefix: string): Promise<Key[]>
  delete(key: Key): Promise<void>
}
```

#### S3 Storage Implementation

**Location**: `modules/s3-storage-client/src/s3-storage-client.ts:30-200`

**Configuration** (lines 35-50):

```typescript
{
  bucket: process.env.BUILD_RAPTOR_S3_BUCKET,
  region: process.env.AWS_REGION || 'us-east-1',
  prefix: 'build-raptor/cache/',
  credentials: AWS.config.credentials  // AWS SDK chain
}
```

**Optimization Strategies** (lines 100-150):

- Parallel uploads for large files
- Request batching for list operations
- Exponential backoff on failures
- Connection pooling

#### Local Storage Fallback

**Location**: `modules/misc/src/in-memory-storage-client.ts:20-100`

Used when S3 unavailable:

- File-based storage in `.build-raptor/cache/`
- LRU eviction policy
- Size-based limits

---

## 5. Step-by-Step Reporting Pipeline

### Overview

Provides real-time visibility into build execution through structured event emission.

### Key Components

#### Event Schema

**Location**: `modules/build-raptor-api/src/build-raptor-api.ts:7-135`

**Event Types**:

```typescript
type Step =
  | { step: 'BUILD_RUN_STARTED'; buildRunId: string }
  | { step: 'TASK_ENDED'; taskName: string; verdict: Verdict }
  | { step: 'ASSET_PUBLISHED'; casAddress: string }
  | { step: 'TEST_ENDED'; testPath: string[]; verdict: TestVerdict }
// ... more event types
```

#### Transmitter (Event Publisher)

**Location**: `modules/build-raptor-core/src/step-by-step-transmitter.ts:20-150`

**Event Flow** (lines 40-80):

```typescript
class StepByStepTransmitter {
  emit(step: Step): void {
    // 1. Validate step schema
    // 2. Write to JSON file
    // 3. Call processor if configured
    // 4. Emit to websocket if connected
  }
}
```

**Output Format**:

```json
{
  "steps": [
    { "step": "BUILD_RUN_STARTED", "buildRunId": "uuid" },
    { "step": "TASK_ENDED", "taskName": "module:build", "verdict": "OK" }
  ]
}
```

#### Processor Integration

**Location**: `modules/build-raptor-api/src/step-by-step-processor.ts:10-40`

**Custom Processor Example**:

```typescript
export const processor: StepByStepProcessor = (step: Step) => {
  if (step.step === 'TASK_ENDED' && step.verdict === 'FAIL') {
    // Send alert to monitoring system
    alerting.notify(`Task ${step.taskName} failed`)
  }
}
```

### Event Ordering Guarantees

1. Events emitted in causal order
2. Task lifecycle events are atomic
3. No events lost on crash (write-through)

---

## 6. Error Handling & Recovery

### Overview

Comprehensive error handling ensures build failures are debuggable and recoverable.

### Error Categories

#### Build Failures

**Location**: `modules/build-failed-error/src/build-failed-error.ts:5-50`

```typescript
class BuildFailedError extends Error {
  constructor(public readonly failedTasks: TaskName[], public readonly rootCause?: TaskName) {}
}
```

#### System Failures

**Handling** in `modules/build-raptor-core/src/engine.ts:180-220`:

- Out of memory: Graceful task termination
- Disk full: Pause execution, alert user
- Network failure: Retry with backoff

### Recovery Mechanisms

#### Partial Build Recovery

**Location**: `modules/build-raptor-core/src/engine.ts:230-280`

```typescript
async recoverFromFailure(failure: BuildFailure): Promise<void> {
  // 1. Mark failed tasks
  // 2. Continue building independent branches
  // 3. Report partial success
}
```

#### Cache Corruption Recovery

**Location**: `modules/build-raptor-core/src/task-store.ts:190-220`

```typescript
async validateCache(fingerprint: Fingerprint): Promise<boolean> {
  // 1. Verify checksum
  // 2. Check file existence
  // 3. Invalidate if corrupt
}
```

### Debugging Support

#### Task Output Capture

**Location**: `modules/build-raptor-core/src/task-runner.ts:80-130`

All task outputs saved to:

```
.build-raptor/
  main.log          # Build system logs
  tasks/
    ${taskName}.out # Task stdout
    ${taskName}.err # Task stderr
```

#### Execution Tracing

Enable with `--trace` flag:

- Detailed timing information
- Memory usage per task
- Cache hit/miss reasons
- Dependency resolution steps

---

## Common Code Patterns

### Pattern 1: Immutable Task State

```typescript
// DON'T mutate task after creation
task.inputs.push(newInput) // ❌

// DO create new task
const newTask = new Task({ ...task, inputs: [...task.inputs, newInput] }) // ✅
```

### Pattern 2: Async Error Handling

```typescript
// Always wrap async operations
try {
  await taskStore.put(task, outputs)
} catch (error) {
  logger.error(`Cache write failed: ${error}`)
  // Continue without cache - don't fail build
}
```

### Pattern 3: Event Emission

```typescript
// Emit events at state transitions
task.setPhase('EXECUTING')
transmitter.emit({ step: 'TASK_STARTED', taskName: task.name })
```

### Pattern 4: Resource Cleanup

```typescript
// Use finally blocks for cleanup
const handle = await acquireResource()
try {
  await useResource(handle)
} finally {
  await releaseResource(handle)
}
```

---

_This guide provides deep technical understanding of Build Raptor's core subsystems. For module-specific APIs, see the Module Reference Catalog._
