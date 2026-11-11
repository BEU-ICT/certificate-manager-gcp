import { TransientQueueError, type TaskQueue, type TaskRequest } from '../../ports/index.js';
import { assertValidTaskName } from '../../shared/email-task.js';

/** gRPC status code ALREADY_EXISTS. */
const ALREADY_EXISTS = 6;

/** The slice of `CloudTasksClient` this adapter uses, so tests inject a mock. */
export interface CloudTasksClientLike {
  createTask(request: { parent: string; task: CloudTaskDefinition }): Promise<unknown>;
}

export interface CloudTaskDefinition {
  name?: string;
  httpRequest: {
    httpMethod: 'POST';
    url: string;
    headers: Record<string, string>;
    body: Buffer;
    oidcToken: { serviceAccountEmail: string; audience: string };
  };
  dispatchDeadline: { seconds: number };
  scheduleTime?: { seconds: number };
}

export interface CloudTasksQueueOptions {
  client: CloudTasksClientLike;
  project: string;
  location: string;
  queue: string;
  /** Own service URL: base of the task URL and OIDC audience. */
  serviceUrl: string;
  /** Service account that signs the OIDC token (`TASKS_INVOKER_SA`). */
  invokerServiceAccount: string;
}

/** Below the Cloud Run request timeout of 60 s (docs/email-queue.md). */
const DISPATCH_DEADLINE_SECONDS = 55;

/** `QUEUE_ADAPTER=cloud-tasks`: HTTP tasks with an OIDC token, de-duplicated by task name. */
export class CloudTasksQueue implements TaskQueue {
  private readonly parent: string;
  private readonly serviceUrl: string;

  constructor(private readonly options: CloudTasksQueueOptions) {
    this.parent = `projects/${options.project}/locations/${options.location}/queues/${options.queue}`;
    this.serviceUrl = options.serviceUrl.replace(/\/+$/, '');
  }

  async enqueue(task: TaskRequest): Promise<{ created: boolean }> {
    if (
      !/^\/[A-Za-z0-9/_.-]*$/.test(task.handler) ||
      task.handler.includes('//') ||
      task.handler.split('/').includes('..')
    ) {
      throw new RangeError('handler must be an absolute internal path');
    }
    const definition: CloudTaskDefinition = {
      httpRequest: {
        httpMethod: 'POST',
        url: `${this.serviceUrl}${task.handler}`,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(task.payload), 'utf8'),
        oidcToken: {
          serviceAccountEmail: this.options.invokerServiceAccount,
          audience: this.serviceUrl,
        },
      },
      dispatchDeadline: { seconds: DISPATCH_DEADLINE_SECONDS },
    };
    // Cloud Tasks de-duplicates by name only; without `dedupe` it assigns a unique name itself.
    if (task.dedupe) {
      assertValidTaskName(task.name);
      definition.name = `${this.parent}/tasks/${task.name}`;
    }
    if (task.scheduleAt) {
      definition.scheduleTime = { seconds: Math.floor(task.scheduleAt.getTime() / 1000) };
    }
    try {
      await this.options.client.createTask({ parent: this.parent, task: definition });
      return { created: true };
    } catch (err) {
      if (task.dedupe && errorCode(err) === ALREADY_EXISTS) return { created: false };
      // The SDK error can quote the request (payload, URLs): keep only the status code.
      const code = errorCode(err);
      throw new TransientQueueError(
        `Cloud Tasks createTask failed${code === undefined ? '' : ` (code ${code})`}`,
      );
    }
  }
}

function errorCode(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = err.code;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}
