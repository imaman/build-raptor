## TODO

- [x] brand types
- [x] logger
- [x] E2E
- [x] compute fingerprints
- [x] cachce verdicts
- [x] E2E for caching testing
- [x] describe outputs
- [x] cache outputs
- [x] execute in parallel
- [x] respect the --unit CLI flag
- [x] logger unit tests
- [x] exit value should be 0 if all tests pass
- [x] unite stderr and stdout of all units
- [x] detect cycles and yell
- [x] dump logs only of failing tasks
- [x] respect the command flag
- [x] taskgraph should hold task ID not tasks
- [x] driver class for tests
- [x] driver with in-memeory protocol.
- [x] implement a github action storage
- [x] make repo-protocol-teskit a real testkit: it should create a separate protocol object
- [x] separate engine from concrete impls. of repo-protocol, storage, etc.
- [x] move brand.ts to its own pacakge (to reduce the size of the dep that comes with it)
- [x] arrange task logs by directories <task-log-dir>/my-package/build.log
- [x] in action, archive name should include the build run ID or something similar (so that it does not collide with previous downloads)
- [x] in action use the ##group notation in the the log to create sections.
- [x] use event publisher to notify ui layer of the run's progress
- [x] turn repo-protocol into a "use-once" object with an initialize()/close() methods.
- [x] add a CLI option to set concurrency level
- [x] the "including bootstrapping" timing is wrong
- [x] print max-concurrently-executing-tasks when finishes.
- [x] rename run-output.ts (and its class)
- [x] add coverage of task-store (the labels)
- [x] configure Driver via an options object
- [x] rename defolderify()
- [x] make sortBy() take an iterable.
- [x] move this list to a dedicated todo file
- [x] move store-client impls out of misc/src/storage-client.ts
- [x] use the Key from storage-client instead of unknown
- [x] make Key better typed
- [x] add a github-actions input to specify the concurrency level
- [x] track number of concurrently running tasks, print max.
- [x] content hash the output
- [x] store verdict after output
- [x] test that content hashing is used
- [x] directory scanner should pass stat of the file to the callback
- [x] Brand fingerprint.ts
- [x] actions-cli should use the event-publisher mechanism
- [x] validate the names of the units (specified via the --units flag)
- [x] allow the protocol to state which tasks are applicable to which unit
- [x] rename TaskRules and Details.
- [x] add a lint rule to ban 'as T' expressions.
- [x] fail the build if .build-raptor is not gitignored
- [x] concurrency level should be a property of engineoptions
- [x] The Run class (part of Driver) should check for execution of tasks using black-box techniques (i.e., stop relying on data reported by the SUT)
- [x] wipe out the output location of task before it runs.
- [ ] ~~pass build-run-id to each protocol method~~
- [ ] ~~move graph.walk() out of graph.ts~~
- [ ] ~~running core-test's use a different visual formatting for the inner tests (`===== <task-namne> =====`)~~
- [ ] ~~test: output is not recorded when the task fails.~~
- [ ] ~~test: restoreOutput gracefully returns when output is not found ? but maybe we should re-run the task (yes, the verdict was OK but we do not have the output)~~
- [ ] ~~introduce an AbsolutePath and RelativePath types.~~
- [x] pass unit ID to the protocol?
- [x] use the initialize()/close() methods of the protocol, thus avoiding the need to pass a factory to the driver?
- [x] protocol should pass a glob for each unit (not just a directory) to allow selecting certain files.
- [ ] the fingerprint should include the FP of the concrete protocol (in our own repo, when we change yarn-repo-protocol, and 'yarn self-build -u build-raptor-core' it will not be rebuilt b/c it does not have a dep. on yarn-repo-protocol).
- [ ] FP snould include the FP of all tasks that the current task depends on (tricky. how?)
- [ ] tests should be a separate unit.
- [x] allow build task to specify "top-down" semantics, which cancels execution of this task on deps.
- [x] add a root-cause task for short-circuited tasks
- [x] fine-grained re-run (HD rerun of tests)
- [x] each unit/task should have a glob to specify location of files - should affect the files that are fingerprinted
- [ ] colored output
- [ ] publish task
- [ ] promote task
- [ ] print a summary of the results
- [ ] add to the fingerprint all the code that is not in any unit
- [ ] protocol should offer methods to cast tasks strings to TaskId (similarly for unitId)
- [ ] repo-protocol-testkit should have a method that creates a standatd recipe (?)
- [ ] timeouts on invocations.
- [ ] reconsider the 'CRASH' status. It looks like we can just use an exception to indicate a crash.
- [ ] fingerprint of a unit should include the definition of its tasks.
- [ ] add a limit on number of output locations + on number of files in them + total size.
- [ ] denormalize taskrules into a per-unit task-spec.
- [ ] resolve all .skip()s in test files
- [ ] make it possible to cap the storage used by filesystem-storage-client
- [ ] debug: how come we do not have skip-on-main in the build-raptor's own repo?
- [ ] shard tests (of a unit) and run them concurrently
- [ ] regexp/substring on unit names in the CLI (-u foo.\*)
- [ ] safe outputting of values in exceptions
- [ ] mvn protocol
- [ ] python protcol
- [ ] gradle protocol
- [ ] javac protocol
- [ ] yarn protocol
- [ ] lerna protocol
- [ ] neither-lerna-nor-yarn protocol
- [ ] do publishing in github actions
- [ ] do promotion in github actions
- [ ] e2e which consumes docker form another package
- [ ] e2e test for s3-storage-client (s3-storage-client-testkit)
- [ ] the CLI respects the current directory: when running from X only runs tests of X.
- [ ] actions-cli should copy task outputs to a directory structure (as the CLI does)
- [ ] control the env variables passed to tasks
- [ ] CLI flag to control whether failed tasks are re-run. In particular. should default to "no-rerun" in dev machine mode.
- [ ] no re-run of failed builds. just failed tests.
- [ ] when not re-running failed tests, dump their logs directly to the console (as-if they were invoked).
- [ ] when trying to specify dist/tsbuildinfo.json as an output location (as oppopsed to just dist/) compilation becomes signfiicanlty slower (looks like no incremental comilation is happening, because build-raptor deletes it). dist/src+dist/tests is terribel because then there is a mismatch between tsbuildinfo and dist/src (or dist/tests) resulting in under compilation. using dist/ works, but then we can use dist/ for placing the outputs of other tasks (such as pack).
- [ ] when there is a task which decalres output location 'dist' and another one which decalres output-location 'dist-foo' build-raptor emits an "output collision error". apparently we compares prefixes instead of comparing path-segments.
- [ ] this error message is confusing: 'this build-raptor run has crashed due to an unexpected error Error: Output location <xdist-pack> does not exist (under </home/imaman/code/imaman/build-raptor/modules/build-failed-error>)'
- [ ] get rid of the --build-output-locations flag
- [ ] compute next version (with max on existing version) from npm reg
- [ ] e2e tests for yarn-repo-protocol

## Maybe TODO

- [ ] side-effecting tasks? e.g., running "npm install" (assuming it has a task of its own) is needed only if we are going to build something or run tests. if all the tasks that need to run are (say) promote then maybe we do not need to run "npm install"
- [ ] depend on verdict
- [ ] check content of output locations and restore them if does not match FP of sources?
- [ ] error propagation graph
- [ ] stop running tasks which are only needed for a task that already got a verdict?
- [ ] storage client should offer a stream-based API (?)
- [ ] storage-client (and task-store thast wrapping it) should offer a batch-query API (to issue multiple object-exists calls).

```
Confusing output:
    ?2 2975 ~/code/imaman/build-raptor|followups % yarn self-build
    yarn run v1.22.15
    $ time node modules/build-raptor/dist/src/build-raptor-cli test
    logging to /Users/itay_maman/code/imaman/build-raptor/build-raptor.log
    Task ["misc","build"] has already been executed successfully
    Task ["build-run-id","build"] has already been executed successfully
    Task ["logger","build"] has already been executed successfully
    Task ["misc","test"] has already been executed successfully
    Task ["unit-metadata","build"] has already been executed successfully
    Task ["build-run-id","test"] has already been executed successfully
    Task ["actions-cache-storage-client","build"] has already been executed successfully
    Task ["logger","test"] has already been executed successfully
    Task ["unit-metadata","test"] has already been executed successfully
    Task ["actions-cache-storage-client","test"] has already been executed successfully
    ================================= ["repo-protocol","build"] =================================
    ================================= ["build-raptor-core","build"] =================================
    ================================= ["repo-protocol","test"] =================================
    ================================= ["yarn-repo-protocol","build"] =================================

    > build-raptor-core@1.0.0 build
    > tsc -b

    src/engine.ts(103,21): error TS2532: Object is possibly 'undefined'.

    ================================= ["yarn-repo-protocol","test"] =================================

    real	0m3.087s
    user	0m8.031s
    sys	0m0.849s
    error Command failed with exit code 2.
    info Visit https://yarnpkg.com/en/docs/cli/run for documentation about this command.
    ?2 2976 ~/code/imaman/build-raptor|followups %
```

========== weirdest bug ever ==========
My diff: adding the following line to brand.spec.ts:
+// 2022-02-05 0801

running yarn self-build I get the output beblow in which only test was executed (no build task was executed).

logging to /Users/itay_maman/code/imaman/build-raptor/.build-raptor/main.log
Task paths:build succeeded earlier. Skipping.
Task build-raptor-action:build succeeded earlier. Skipping.
Task build-raptor:build succeeded earlier. Skipping.
Task paths:test succeeded earlier. Skipping.
Task build-raptor-action:test succeeded earlier. Skipping.
Task build-raptor:test succeeded earlier. Skipping.
OVERSHADOWED: task build-failed-error:build.
OVERSHADOWED: task actions-cache-storage-client:build.
OVERSHADOWED: task build-run-id:build.
OVERSHADOWED: task unit-metadata:build.
OVERSHADOWED: task task-name:build.
OVERSHADOWED: task yarn-repo-protocol:build.
OVERSHADOWED: task repo-protocol:build.
Task build-failed-error:test succeeded earlier. Skipping.
Task actions-cache-storage-client:test succeeded earlier. Skipping.
Task build-run-id:test succeeded earlier. Skipping.
Task unit-metadata:test succeeded earlier. Skipping.
Task task-name:test succeeded earlier. Skipping.
Task yarn-repo-protocol:test succeeded earlier. Skipping.
OVERSHADOWED: task brand:build.
OVERSHADOWED: task logger:build.
Task repo-protocol:test succeeded earlier. Skipping.
OVERSHADOWED: task build-raptor-core:build.
================================= brand:test =================================
OVERSHADOWED: task misc:build.
Task logger:test succeeded earlier. Skipping.
Task build-raptor-core:test succeeded earlier. Skipping.
Task misc:test succeeded earlier. Skipping.

Yet the change does appear in the dist folder:
% tail modules/brand/dist/tests/brand.spec.js
"use strict";
describe('brand', () => {
test('foo', () => {
expect(5).toEqual(5);
});
});
// 2022-02-05 0801
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnJhbmQuc3BlYy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3Rlc3RzL2JyYW5kLnNwZWMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLFFBQVEsQ0FBQyxPQUFPLEVBQUUsR0FBRyxFQUFFO0lBQ3JCLElBQUksQ0FBQyxLQUFLLEVBQUUsR0FBRyxFQUFFO1FBQ2YsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUN0QixDQUFDLENBQUMsQ0FBQTtBQUNKLENBQUMsQ0FBQyxDQUFBO0FBRUYsbUJBQW1CIn0=%

==========

- transitive: do not run build in dep if is due to run at dependent
- separate tests build from application build
- fp of task (should include fp of dep tasks)

* task-name

==========

- modules/build-raptor-core/src/validate-task-infos.ts => testing of the reg
- fingerprinter.spec.ts - untodo
- modules/build-raptor-core/tests/minimal-testing.spec.ts - unskip
- planner.spec - test('when a task definition changes, the task will run', untodo
