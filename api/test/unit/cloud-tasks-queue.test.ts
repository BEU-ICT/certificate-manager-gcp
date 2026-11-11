import { describe, expect, it, vi } from 'vitest';
import {
  CloudTasksQueue,
  type CloudTasksClientLike,
} from '../../src/adapters/cloud-tasks/cloud-tasks-queue.js';
import { TransientQueueError } from '../../src/ports/index.js';

const PARENT = 'projects/proj/locations/us-east1/queues/email-queue';

function setup(createTask: CloudTasksClientLike['createTask'] = () => Promise.resolve([{}])) {
  const client = { createTask: vi.fn(createTask) };
  const queue = new CloudTasksQueue({
    client,
    project: 'proj',
    location: 'us-east1',
    queue: 'email-queue',
    serviceUrl: 'https://api-abc.a.run.app/',
    invokerServiceAccount: 'tasks-invoker@proj.iam.gserviceaccount.com',
  });
  return { client, queue };
}

const request = {
  name: 'email-abc-1',
  handler: '/internal/tasks/send-email',
  payload: { certificateId: 'abc', sequence: 1 },
  dedupe: true,
};

describe('CloudTasksQueue', () => {
  it('creates an HTTP task with URL, JSON body, OIDC token, deadline and full name', async () => {
    const { client, queue } = setup();
    await expect(queue.enqueue(request)).resolves.toEqual({ created: true });
    const arg = client.createTask.mock.calls[0]?.[0];
    expect(arg?.parent).toBe(PARENT);
    expect(arg?.task.name).toBe(`${PARENT}/tasks/email-abc-1`);
    expect(arg?.task.httpRequest.httpMethod).toBe('POST');
    expect(arg?.task.httpRequest.url).toBe('https://api-abc.a.run.app/internal/tasks/send-email');
    expect(arg?.task.httpRequest.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(arg?.task.httpRequest.body.toString('utf8') ?? '')).toEqual(request.payload);
    expect(arg?.task.httpRequest.oidcToken).toEqual({
      serviceAccountEmail: 'tasks-invoker@proj.iam.gserviceaccount.com',
      audience: 'https://api-abc.a.run.app',
    });
    expect(arg?.task.dispatchDeadline).toEqual({ seconds: 55 });
    expect(arg?.task.scheduleTime).toBeUndefined();
  });

  it('sets scheduleTime from scheduleAt', async () => {
    const { client, queue } = setup();
    await queue.enqueue({ ...request, scheduleAt: new Date('2030-01-01T00:00:10.500Z') });
    expect(client.createTask.mock.calls[0]?.[0].task.scheduleTime).toEqual({
      seconds: Date.parse('2030-01-01T00:00:10Z') / 1000,
    });
  });

  it('treats ALREADY_EXISTS as created: false', async () => {
    const { queue } = setup(() => Promise.reject(Object.assign(new Error('exists'), { code: 6 })));
    await expect(queue.enqueue(request)).resolves.toEqual({ created: false });
  });

  it('wraps other errors in TransientQueueError without payload or SDK message', async () => {
    const { queue } = setup(() =>
      Promise.reject(Object.assign(new Error('boom secret@example.com'), { code: 14 })),
    );
    const err = await queue.enqueue(request).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransientQueueError);
    expect((err as Error).message).toBe('Cloud Tasks createTask failed (code 14)');
    expect((err as Error).cause).toBeUndefined();
  });

  it('wraps errors without a code', async () => {
    const { queue } = setup(() => Promise.reject(new Error('network')));
    await expect(queue.enqueue(request)).rejects.toBeInstanceOf(TransientQueueError);
  });

  it('leaves the name to Cloud Tasks and surfaces ALREADY_EXISTS when dedupe is false', async () => {
    const { client, queue } = setup(() =>
      Promise.reject(Object.assign(new Error('x'), { code: 6 })),
    );
    await expect(queue.enqueue({ ...request, dedupe: false })).rejects.toBeInstanceOf(
      TransientQueueError,
    );
    expect(client.createTask.mock.calls[0]?.[0].task.name).toBeUndefined();
  });

  it('rejects invalid names and handlers before calling the API', async () => {
    const { client, queue } = setup();
    await expect(queue.enqueue({ ...request, name: 'bad name' })).rejects.toThrow(RangeError);
    await expect(queue.enqueue({ ...request, handler: 'https://evil.example/x' })).rejects.toThrow(
      RangeError,
    );
    await expect(queue.enqueue({ ...request, handler: '//evil.example/x' })).rejects.toThrow(
      RangeError,
    );
    await expect(queue.enqueue({ ...request, handler: '/internal/../admin' })).rejects.toThrow(
      RangeError,
    );
    await expect(queue.enqueue({ ...request, handler: '/internal/..' })).rejects.toThrow(
      RangeError,
    );
    expect(client.createTask).not.toHaveBeenCalled();
  });
});
