import { describeTemplateCopyApi } from '../helpers/template-copy-suite.js';
import { createFakes } from '../../src/testing/fakes/index.js';

describeTemplateCopyApi('in-memory fakes', () => createFakes());
