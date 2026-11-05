/** Public interface of the templates module; other modules import only this file. */
export {
  DEFAULT_FORMATS,
  FIELD_KINDS,
  FIELD_NAMES,
  assertTemplateConfig,
  PAGE_SIZES_PT,
  pageDimensions,
  parseTemplateConfig,
  templateConfigInputSchema,
  templateConfigSchema,
  type ConfigIssue,
  type FieldConfig,
  type FieldName,
  type ParseTemplateConfigOptions,
  type TemplateConfig,
  type TemplateConfigResult,
} from './config.js';
export { templateConfigJsonSchema } from './config-json-schema.js';
export {
  FORMAT_KINDS,
  FORMAT_NAMES,
  KNOWN_FORMATS,
  isKnownFormat,
  type FormatKind,
  type FormatName,
} from './formats.js';
export { isSafePackagePath, packagePathProblem } from './paths.js';
export { MAX_REFERENCE_LENGTH, buildTemplateReference } from './reference.js';
export {
  TEMPLATES_BUCKET,
  templateAssetKey,
  templateBackgroundKey,
  templateConfigKey,
  templateFontKey,
  templateKey,
  templateStoragePath,
} from './storage-keys.js';
export {
  DefaultTemplateService,
  MAX_REFERENCE_RETRIES,
  type NextReference,
  type PublishTemplateInput,
  type TemplateFile,
  type TemplateService,
  type TemplateTarget,
} from './service.js';
