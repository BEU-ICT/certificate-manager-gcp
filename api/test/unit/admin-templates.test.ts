import { describeTemplatesApi } from '../helpers/templates-api-suite.js';
import { createFakes } from '../../src/testing/fakes/index.js';

describeTemplatesApi('in-memory fakes', () => createFakes());
