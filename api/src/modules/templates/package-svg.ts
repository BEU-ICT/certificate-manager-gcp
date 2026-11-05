import {
  PACKAGE_LIMITS,
  VIEWBOX_OK_TOLERANCE,
  VIEWBOX_WARN_TOLERANCE,
  type Issue,
} from './package-issues.js';
import { XmlSyntaxError, tokenizeXml, type XmlTag } from './package-xml.js';

export interface SvgCheckResult {
  errors: Omit<Issue, 'path' | 'file'>[];
  warnings: Omit<Issue, 'path' | 'file'>[];
}

type Finding = Omit<Issue, 'path' | 'file'>;

const IN_DOCUMENT_REF = /^#[A-Za-z_][\w.:-]*$/;
const DATA_IMAGE_REF = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=\s]*$/;
/** ASCII-only case fold; unlike `toLowerCase` it never changes the string length. */
const asciiLower = (value: string): string => value.replace(/[A-Z]+/g, (run) => run.toLowerCase());
const CSS_IMAGE_FUNCTIONS = ['image-set(', 'image(', 'cross-fade('];
const DOCTYPE = /<!\s*(?:DOCTYPE|ENTITY)/i;
const SMIL_ELEMENTS = new Set(['set', 'animate', 'animatetransform', 'animatemotion']);

/** An `href` / `url(...)` target is allowed when it points inside the document or is an inline PNG/JPEG. */
function isAllowedReference(value: string): boolean {
  const trimmed = value.trim();
  return IN_DOCUMENT_REF.test(trimmed) || DATA_IMAGE_REF.test(trimmed);
}

function parseViewBox(value: string): { width: number; height: number } | undefined {
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return undefined;
  const width = parts[2];
  const height = parts[3];
  if (width === undefined || height === undefined || width <= 0 || height <= 0) return undefined;
  return { width, height };
}

/**
 * Static safety and layout checks of `background.svg`. Pure: parses with the strict tokenizer in `package-xml.ts`, which never
 * expands entities and never fetches anything; any DTD is rejected up front. The input must
 * already be within the size limit. Each rule is reported once per file.
 */
export function checkSvg(bytes: Buffer, page: { width: number; height: number }): SvgCheckResult {
  const errors = new Map<string, Finding>();
  const warnings = new Map<string, Finding>();
  const fail = (code: string, message: string): void => {
    if (!errors.has(code)) errors.set(code, { code, message });
  };
  const warn = (code: string, message: string): void => {
    if (!warnings.has(code)) warnings.set(code, { code, message });
  };
  const result = (): SvgCheckResult => ({
    errors: [...errors.values()],
    warnings: [...warnings.values()],
  });

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    fail('SVG_NOT_XML', 'File is not valid UTF-8 text');
    return result();
  }

  if (DOCTYPE.test(text)) {
    fail('SVG_DOCTYPE', 'DOCTYPE and ENTITY declarations are not allowed (XXE / entity expansion)');
    return result();
  }

  // Linear scan (no backtracking regex). CSS escapes would hide `url(` / `@import`, so they are rejected.
  const checkUrls = (value: string, where: string): void => {
    if (value.includes('\\')) {
      fail('SVG_CSS_ESCAPE', `Backslash escapes in ${where} are not allowed`);
      return;
    }
    const lower = asciiLower(value);
    if (CSS_IMAGE_FUNCTIONS.some((fn) => lower.includes(fn))) {
      fail('SVG_EXTERNAL_REFERENCE', `CSS image functions in ${where} are not allowed`);
    }
    if (lower.includes('@import')) fail('SVG_CSS_IMPORT', `CSS @import in ${where} is not allowed`);
    let from = 0;
    for (;;) {
      const start = lower.indexOf('url(', from);
      if (start === -1) return;
      const end = lower.indexOf(')', start + 4);
      if (end === -1) {
        fail('SVG_EXTERNAL_REFERENCE', `Unterminated url( in ${where}`);
        return;
      }
      const target = value
        .slice(start + 4, end)
        .trim()
        .replace(/^(['"])(.*)\1$/s, '$2');
      if (!isAllowedReference(target)) {
        fail(
          'SVG_EXTERNAL_REFERENCE',
          `url(...) in ${where} must point to an in-document #id or a data:image/png|jpeg URI`,
        );
      }
      from = end + 1;
    }
  };

  let depth = 0;
  let nodes = 0;
  let rootSeen = false;
  let styleDepth = 0;
  let styleText: string[] = [];

  /** Thrown by a rule to stop parsing early (limits). */
  class Abort extends Error {}
  const abort = (code: string, message: string): never => {
    fail(code, message);
    throw new Abort();
  };

  const opentag = (tag: XmlTag): void => {
    depth++;
    nodes++;
    if (depth > PACKAGE_LIMITS.maxSvgDepth || nodes > PACKAGE_LIMITS.maxSvgNodes) {
      abort('SVG_TOO_COMPLEX', 'SVG nesting depth or element count exceeds the limit');
    }
    const local = tag.local.toLowerCase();
    if (!rootSeen) {
      rootSeen = true;
      if (tag.local !== 'svg' || tag.uri !== 'http://www.w3.org/2000/svg') {
        fail('SVG_ROOT_NOT_SVG', 'The root element must be <svg> in the SVG namespace');
      } else {
        const raw = tag.attributes['viewBox']?.value;
        const box = raw === undefined ? undefined : parseViewBox(raw);
        if (box === undefined) {
          fail('SVG_NO_VIEWBOX', 'The root <svg> needs a valid viewBox="minX minY width height"');
        } else {
          const diff = Math.abs(box.width / box.height / (page.width / page.height) - 1);
          const detail = `viewBox ${String(box.width)}x${String(box.height)} vs page ${String(Math.round(page.width * 100) / 100)}x${String(Math.round(page.height * 100) / 100)} pt (${(diff * 100).toFixed(1)}% off)`;
          if (diff > VIEWBOX_WARN_TOLERANCE)
            fail('SVG_VIEWBOX_MISMATCH', `Aspect ratio differs by more than 3%: ${detail}`);
          else if (diff > VIEWBOX_OK_TOLERANCE)
            warn('SVG_VIEWBOX_ASPECT', `Aspect ratio differs by 1-3%: ${detail}`);
        }
      }
    }
    if (local === 'script') fail('SVG_SCRIPT', '<script> elements are not allowed');
    if (local === 'foreignobject') fail('SVG_FOREIGN_OBJECT', '<foreignObject> is not allowed');
    if (local === 'text') {
      warn(
        'SVG_TEXT_ELEMENTS',
        'Contains <text> elements; fonts are not embedded in SVG, convert text to outlines',
      );
    }
    if (local === 'style') styleDepth++;
    const smil = SMIL_ELEMENTS.has(local);
    const attributes = Object.values(tag.attributes);
    if (attributes.length > PACKAGE_LIMITS.maxSvgAttributes) {
      abort('SVG_TOO_COMPLEX', 'An element has too many attributes');
      return;
    }
    for (const attribute of attributes) {
      const name = attribute.local.toLowerCase();
      if (attribute.name === 'xml:base') {
        fail('SVG_EXTERNAL_REFERENCE', 'xml:base is not allowed');
      }
      if (name.startsWith('on'))
        fail(
          'SVG_EVENT_HANDLER',
          `Event-handler attribute "${attribute.name.slice(0, 40)}" is not allowed`,
        );
      if (name === 'href' && !isAllowedReference(attribute.value)) {
        fail(
          'SVG_EXTERNAL_REFERENCE',
          `${tag.name === 'use' ? '<use>' : 'href'} must point to an in-document #id or a data:image/png|jpeg URI`,
        );
      }
      if (smil && name === 'attributename' && /(^|:)href$/i.test(attribute.value.trim())) {
        fail('SVG_EXTERNAL_REFERENCE', 'Animating href is not allowed');
      }
      if (
        attribute.value.includes('(') ||
        name === 'style' ||
        (smil && ['to', 'from', 'by', 'values'].includes(name))
      )
        checkUrls(attribute.value, `attribute "${attribute.name.slice(0, 40)}"`);
    }
  };
  const closetag = (tag: XmlTag): void => {
    depth--;
    if (tag.local.toLowerCase() === 'style') {
      styleDepth--;
      if (styleDepth === 0) checkUrls(styleText.join(''), '<style>');
      if (styleDepth === 0) styleText = [];
    }
  };
  const processingInstruction = (target: string): void => {
    if (target.toLowerCase() !== 'xml') {
      fail(
        'SVG_PROCESSING_INSTRUCTION',
        'Processing instructions (e.g. xml-stylesheet) are not allowed',
      );
    }
  };
  // Collect a whole <style> before scanning it.
  const onText = (value: string): void => {
    if (styleDepth > 0) styleText.push(value);
  };

  try {
    tokenizeXml(
      text,
      { opentag, closetag, text: onText, processingInstruction },
      PACKAGE_LIMITS.maxSvgAttributes,
    );
  } catch (error) {
    if (error instanceof XmlSyntaxError && error.message === 'Too many attributes') {
      fail('SVG_TOO_COMPLEX', 'An element has too many attributes');
    } else if (error instanceof XmlSyntaxError) {
      fail('SVG_NOT_XML', `Not well-formed XML: ${error.message.slice(0, 120)}`);
    } else if (!(error instanceof Abort)) {
      throw error;
    }
  }
  return result();
}
