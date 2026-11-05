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
