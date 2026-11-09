import { describeTemplateUploadApi } from '../helpers/template-upload-suite.js';
import { createFakes } from '../../src/testing/fakes/index.js';

describeTemplateUploadApi('in-memory fakes', () => createFakes());
