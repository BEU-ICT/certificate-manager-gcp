import type { TaskQueue, TaskRequest } from '../../ports/index.js';

/** Records enqueued tasks; nothing is executed. Dedupe is by task name. */
export class FakeTaskQueue implements TaskQueue {
  readonly tasks: TaskRequest[] = [];
  private readonly names = new Set<string>();

  enqueue(task: TaskRequest): Promise<{ created: boolean }> {
    if (task.dedupe && this.names.has(task.name)) return Promise.resolve({ created: false });
    this.names.add(task.name);
    this.tasks.push(structuredClone(task));
    return Promise.resolve({ created: true });
  }

  /** Removes and returns the recorded tasks (names stay reserved, like a real queue). */
  drain(): TaskRequest[] {
    return this.tasks.splice(0);
  }
}
