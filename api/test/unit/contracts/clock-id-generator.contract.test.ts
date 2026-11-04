import { SystemClock } from '../../../src/adapters/system/clock.js';
import { RandomIdGenerator } from '../../../src/adapters/system/id-generator.js';
import {
  describeClockContract,
  describeIdGeneratorContract,
} from '../../../src/testing/contracts/index.js';
import { FakeClock, FakeIdGenerator } from '../../../src/testing/fakes/index.js';

describeClockContract('FakeClock', () => ({ adapter: new FakeClock(), cleanup: () => undefined }));
describeClockContract('SystemClock', () => ({
  adapter: new SystemClock(),
  cleanup: () => undefined,
}));

describeIdGeneratorContract('FakeIdGenerator', () => ({
  adapter: new FakeIdGenerator(),
  cleanup: () => undefined,
}));
describeIdGeneratorContract('RandomIdGenerator', () => ({
  adapter: new RandomIdGenerator(),
  cleanup: () => undefined,
}));
