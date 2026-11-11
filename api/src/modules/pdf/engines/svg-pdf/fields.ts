import { FIELD_NAMES, assertTemplateConfig, type FieldName } from '../../../templates/index.js';
import type { FieldConfig, TemplateConfig } from '../../../templates/index.js';
import { createFormatterRegistry } from '../../formatters-builtin.js';
import type { FormatterRegistry } from '../../formatters.js';
import type { FitIssue, FitResult, RenderAssets, RenderInput } from '../../renderer.js';
import type { DrawContext, DrawLayer } from './context.js';
import { fieldFont } from './fonts.js';
import { checkQrFit } from './qr.js';
import { layoutField, type FieldFont, type FieldLayout } from './layout.js';

export const TEXT_DOES_NOT_FIT = 'TEXT_DOES_NOT_FIT';

export interface FieldsOptions {
  /** Formatter registry; defaults to the built-in set. */
  formatters?: FormatterRegistry;
}

export interface FieldsPlugin {
  /** Draws every configured, non-empty field. */
  fieldsLayer: DrawLayer;
  /** Lays out every field with the real font metrics (no PDF is created) and reports all misfits. */
  checkFit: (input: RenderInput, assets: RenderAssets) => FitResult;
}

interface PlacedField {
  name: FieldName;
  config: FieldConfig;
  layout: FieldLayout;
  font: FieldFont;
}

function rawValue(name: FieldName, input: RenderInput): unknown {
  switch (name) {
    case 'ownerName':
      return input.ownerName;
    case 'subject':
      return input.subject;
    case 'skills':
      return input.skills;
    case 'issuedAt':
      return input.issuedAt;
    case 'type':
      return input.type;
  }
}

function isEmptyValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() === '';
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && v.trim() === '');
}

/**
 * Formats and lays out each configured field. Empty values are skipped. This single code path
 * serves both `render` and `checkFit`, so their line breaks are identical by construction.
 */
function layoutAll(
  config: TemplateConfig,
  input: RenderInput,
  assets: RenderAssets,
  formatters: FormatterRegistry,
): PlacedField[] {
  const placed: PlacedField[] = [];
  for (const name of FIELD_NAMES) {
    const field = config.fields[name];
    if (field === undefined) continue;
    const value = rawValue(name, input);
    if (isEmptyValue(value)) continue;
    const text = formatters.format(field.format, value, { locale: config.locale });
    const data = assets.fonts.get(field.font);
    if (data === undefined) throw new Error(`Template font "${field.font}" is not loaded`);
    const font = fieldFont(data);
    placed.push({ name, config: field, layout: layoutField(text, field, font), font });
  }
  return placed;
}

function issueFor({ name, config, layout }: PlacedField): FitIssue {
  return {
    field: name,
    message: `Text needs ${String(layout.requiredLines)} lines at the minimum size ${String(config.minSize)} pt but the field allows ${String(config.maxLines)}`,
    reason: TEXT_DOES_NOT_FIT,
    requiredLines: layout.requiredLines,
    maxLines: config.maxLines,
    minSize: config.minSize,
  };
}

/** Builds the fields layer and the matching `checkFit` for `SvgPdfRendererOptions`. */
export function createFields(options: FieldsOptions = {}): FieldsPlugin {
  const formatters = options.formatters ?? createFormatterRegistry();
  const fieldsLayer: DrawLayer = (ctx: DrawContext) => {
    for (const { config, layout, font } of layoutAll(
      ctx.config,
      ctx.input,
      ctx.assets,
      formatters,
    )) {
      ctx.doc.font(ctx.fontName(config.font)).fontSize(layout.fontSize).fillColor(config.color);
      for (const line of layout.lines) {
        const top = config.y + line.baselineY - font.ascent(layout.fontSize);
        ctx.doc.text(line.text, config.x + line.offsetX, top, { lineBreak: false });
      }
    }
  };
  const checkFit = (input: RenderInput, assets: RenderAssets): FitResult => {
    const { config } = assertTemplateConfig(assets.template.config);
    const issues: FitIssue[] = layoutAll(config, input, assets, formatters)
      .filter((p) => !p.layout.fits)
      .map(issueFor);
    // The QR code is part of the same layout verdict (BEU-ICT/certificate-manager#323).
    issues.push(...checkQrFit(input, config));
    return { fits: issues.length === 0, issues };
  };
  return { fieldsLayer, checkFit };
}
