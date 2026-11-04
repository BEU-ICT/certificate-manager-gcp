import { describeEventsApi } from '../helpers/events-api-suite.js';
import { createFakes } from '../../src/testing/fakes/index.js';

describeEventsApi('in-memory fakes', () => createFakes());
