import { createFakes } from '../../src/testing/fakes/index.js';
import { describeTemplatePreviewApi } from '../helpers/template-preview-suite.js';

describeTemplatePreviewApi('in-memory fakes', () => createFakes());
