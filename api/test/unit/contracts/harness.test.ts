import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { startVitest } from 'vitest/node';

const fixture = fileURLToPath(new URL('./fixtures/broken-adapters.fixture.ts', import.meta.url));

interface Outcome {
  suite: string;
  title: string;
  state: string | undefined;
  message: string;
}

/** Runs the broken-adapter fixture in a nested Vitest instance and collects every test outcome. */
async function runBrokenAdapters(): Promise<Outcome[]> {
  const vitest = await startVitest('test', [], {
    watch: false,
    run: true,
    include: [fixture],
    reporters: [],
    coverage: { enabled: false },
  });
  try {
    const files = vitest.state.getFiles();
    const outcomes: Outcome[] = [];
    for (const file of files) {
      for (const task of file.tasks) {
        if (task.type !== 'suite') continue;
        for (const test of task.tasks) {
          if (test.type !== 'test') continue;
          outcomes.push({
            suite: task.name,
            title: test.name,
            state: test.result?.state,
            message: test.result?.errors?.map((e) => e.message).join('\n') ?? '',
          });
        }
      }
    }
    return outcomes;
  } finally {
    await vitest.close();
    // The nested run fails on purpose; do not let it fail this process.
    process.exitCode = 0;
  }
}

describe('contract harness', () => {
  it('fails a suite when an adapter breaks the contract, naming the violated clause', async () => {
    const outcomes = await runBrokenAdapters();
    const failures = (suite: string) =>
      outcomes.filter((o) => o.suite.includes(suite) && o.state === 'fail');
    const ran = (suite: string) => outcomes.filter((o) => o.suite.includes(suite)).length;

    for (const suite of ['racy putIfAbsent', 'ignores dedupe', 'never limits', 'publish rejects']) {
      expect(ran(suite), `${suite}: suite did not run`).toBeGreaterThan(0);
      expect(failures(suite).length, `${suite}: expected a failing test`).toBeGreaterThan(0);
    }

    expect(
      failures('racy putIfAbsent')
        .map((o) => o.message)
        .join('\n'),
    ).toContain(
      'StorageGateway contract violated: "putIfAbsent: Exactly one of concurrent callers gets created: true"',
    );
    expect(
      failures('ignores dedupe')
        .map((o) => o.message)
        .join('\n'),
    ).toContain(
      'TaskQueue contract violated: "enqueue: With dedupe: true an existing task of the same name',
    );
    expect(
      failures('never limits')
        .map((o) => o.message)
        .join('\n'),
    ).toContain('RateLimiter contract violated: "consume: Counts one request against key');
    expect(
      failures('publish rejects')
        .map((o) => o.message)
        .join('\n'),
    ).toContain(
      'EventBus contract violated: "publish: A failing subscriber is logged and never makes publish reject"',
    );
  }, 60_000);
});
