/**
 * Small strict XML tokenizer for `background.svg` (replaces a general SAX parser, which was too slow
 * on multi-megabyte attribute values). Linear time, no backtracking regexes on untrusted input, and
 * it supports only what an SVG needs: elements, attributes, text, CDATA, comments, processing
 * instructions, the five predefined entities and numeric character references, and `xmlns`
 * namespaces. A DTD or any custom entity is a syntax error, so nothing is ever expanded or fetched.
 */

export class XmlSyntaxError extends Error {}

export interface XmlAttribute {
  /** Qualified name as written, e.g. `xlink:href`. */
  name: string;
  local: string;
  /** Value with character references decoded. */
  value: string;
}

export interface XmlTag {
  name: string;
  local: string;
  /** Resolved namespace URI of the element, `''` when none. */
  uri: string;
  attributes: Record<string, XmlAttribute>;
  selfClosing: boolean;
}

export interface XmlHandlers {
  opentag(tag: XmlTag): void;
  closetag(tag: XmlTag): void;
  /** Character data (entities decoded) and CDATA (verbatim), so rules see what a renderer sees. */
  text(value: string): void;
  processingInstruction(target: string): void;
}

const NAME = /[A-Za-z_\u00C0-\uFFFF][A-Za-z0-9_.:\u00B7\u00C0-\uFFFF-]*/y;
// Sticky, so `decode` can validate one reference at a time and stop at the first bad one.
const ENTITY = /&(?:(#x[0-9A-Fa-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);)/y;
const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

const isSpace = (code: number): boolean =>
  code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;

/** Decodes predefined entities and character references in one linear pass; any other `&` throws. */
function decode(value: string): string {
  let at = value.indexOf('&');
  if (at === -1) return value;
  let out = '';
  let last = 0;
  while (at !== -1) {
    ENTITY.lastIndex = at;
    const match = ENTITY.exec(value);
    const body = match?.[1];
    if (match === null || body === undefined) {
      throw new XmlSyntaxError('Undefined or malformed entity reference');
    }
    let replacement: string;
    if (!body.startsWith('#')) {
      replacement = PREDEFINED[body] ?? '';
    } else {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) {
        throw new XmlSyntaxError('Character reference to a control character');
      }
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        throw new XmlSyntaxError('Invalid character reference');
      }
      replacement = String.fromCodePoint(code);
    }
    out += value.slice(last, at) + replacement;
    last = at + match[0].length;
    at = value.indexOf('&', last);
  }
  return out + value.slice(last);
}

function readName(text: string, at: number): string {
  NAME.lastIndex = at;
  const match = NAME.exec(text);
  if (match === null) throw new XmlSyntaxError('Invalid name');
  return match[0];
}

function split(name: string): { prefix: string; local: string } {
  const colon = name.indexOf(':');
  if (colon === -1) return { prefix: '', local: name };
  const local = name.slice(colon + 1);
  if (colon === 0 || local === '' || local.includes(':')) {
    throw new XmlSyntaxError('Invalid qualified name');
  }
  return { prefix: name.slice(0, colon), local };
}

interface Scope {
  [prefix: string]: string | undefined;
}

/**
 * Tokenizes `text` and calls the handlers in document order. Throws `XmlSyntaxError` on anything
 * that is not well-formed; handlers may throw to stop early. `maxAttributes` bounds each tag.
 */
export function tokenizeXml(text: string, handlers: XmlHandlers, maxAttributes: number): void {
  const stack: { tag: XmlTag; scope: Scope }[] = [];
  let scope: Scope = Object.assign(Object.create(null) as Scope, { xml: XML_NS });
  let pos = 0;
  let roots = 0;
  const length = text.length;

  while (pos < length) {
    const lt = text.indexOf('<', pos);
    const end = lt === -1 ? length : lt;
    if (end > pos) {
      const chunk = text.slice(pos, end);
      if (stack.length === 0) {
        if (chunk.trim() !== '') throw new XmlSyntaxError('Text outside the root element');
      } else {
        if (chunk.includes(']]>')) throw new XmlSyntaxError('Unexpected "]]>"');
        handlers.text(decode(chunk));
      }
    }
    if (lt === -1) break;
    pos = lt;
    const next = text.charCodeAt(pos + 1);
    if (text.startsWith('<!--', pos)) {
      const close = text.indexOf('-->', pos + 4);
      if (close === -1 || text.startsWith('<!-->', pos) || text.startsWith('<!--->', pos)) {
        throw new XmlSyntaxError('Malformed comment');
      }
      const body = text.slice(pos + 4, close);
      if (body.includes('--') || body.endsWith('-')) {
        throw new XmlSyntaxError('"--" is not allowed inside a comment');
      }
      pos = close + 3;
    } else if (text.startsWith('<![CDATA[', pos)) {
      const close = text.indexOf(']]>', pos + 9);
      if (close === -1 || stack.length === 0) throw new XmlSyntaxError('Bad CDATA section');
      handlers.text(text.slice(pos + 9, close));
      pos = close + 3;
    } else if (next === 0x3f /* ? */) {
      const close = text.indexOf('?>', pos + 2);
      if (close === -1) throw new XmlSyntaxError('Unterminated processing instruction');
      const target = readName(text, pos + 2);
      if (target.toLowerCase() === 'xml' && pos !== 0) {
        throw new XmlSyntaxError('XML declaration must be at the start');
      }
      if (target.toLowerCase() === 'xml') {
        const declaration = text.slice(pos + 5, close);
        if (declaration.length > 200) throw new XmlSyntaxError('XML declaration too long');
        const encoding = /encoding\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(declaration);
        const label = (encoding?.[1] ?? encoding?.[2] ?? 'utf-8').toLowerCase();
        if (label !== 'utf-8') throw new XmlSyntaxError('Only UTF-8 is supported');
      }
      handlers.processingInstruction(target);
      pos = close + 2;
    } else if (next === 0x21 /* ! */) {
      throw new XmlSyntaxError('Unsupported markup declaration');
    } else if (next === 0x2f /* / */) {
      const name = readName(text, pos + 2);
      let at = pos + 2 + name.length;
      while (at < length && isSpace(text.charCodeAt(at))) at++;
      const top = stack.pop();
      if (text.charCodeAt(at) !== 0x3e || top === undefined || top.tag.name !== name) {
        throw new XmlSyntaxError('Mismatched closing tag');
      }
      handlers.closetag(top.tag);
      scope =
        stack[stack.length - 1]?.scope ??
        Object.assign(Object.create(null) as Scope, { xml: XML_NS });
      pos = at + 1;
    } else {
      if (stack.length === 0 && roots > 0) throw new XmlSyntaxError('More than one root element');
      const name = readName(text, pos + 1);
      let at = pos + 1 + name.length;
      const raw: (XmlAttribute & { prefix: string })[] = [];
      const seen = new Set<string>();
      let selfClosing = false;
      for (;;) {
        const start = at;
        while (at < length && isSpace(text.charCodeAt(at))) at++;
        const code = text.charCodeAt(at);
        if (code === 0x3e) {
          at++;
          break;
        }
        if (code === 0x2f && text.charCodeAt(at + 1) === 0x3e) {
          selfClosing = true;
          at += 2;
          break;
        }
        if (at === start || at >= length) throw new XmlSyntaxError('Malformed tag');
        if (raw.length >= maxAttributes) throw new XmlSyntaxError('Too many attributes');
        const attrName = readName(text, at);
        at += attrName.length;
        while (at < length && isSpace(text.charCodeAt(at))) at++;
        if (text.charCodeAt(at) !== 0x3d) throw new XmlSyntaxError('Attribute without value');
        at++;
        while (at < length && isSpace(text.charCodeAt(at))) at++;
        const quote = text.charCodeAt(at);
        if (quote !== 0x22 && quote !== 0x27) throw new XmlSyntaxError('Unquoted attribute value');
        const close = text.indexOf(quote === 0x22 ? '"' : "'", at + 1);
        if (close === -1) throw new XmlSyntaxError('Unterminated attribute value');
        const value = text.slice(at + 1, close);
        if (value.includes('<')) throw new XmlSyntaxError('"<" in attribute value');
        if (seen.has(attrName)) throw new XmlSyntaxError('Duplicate attribute');
        seen.add(attrName);
        const parts = split(attrName);
        raw.push({
          name: attrName,
          local: parts.local,
          prefix: parts.prefix,
          value: decode(value),
        });
        at = close + 1;
      }

      let tagScope = scope;
      for (const attribute of raw) {
        if (attribute.name === 'xmlns' || attribute.prefix === 'xmlns') {
          if (tagScope === scope) tagScope = Object.create(scope) as Scope;
          tagScope[attribute.name === 'xmlns' ? '' : attribute.local] = attribute.value;
        }
      }
      const { prefix, local } = split(name);
      const uri = tagScope[prefix];
      if (uri === undefined && prefix !== '') throw new XmlSyntaxError('Undeclared prefix');
      const attributes = Object.create(null) as Record<string, XmlAttribute>;
      for (const attribute of raw) {
        const attrPrefix = attribute.prefix;
        if (attrPrefix !== '' && attrPrefix !== 'xmlns' && tagScope[attrPrefix] === undefined) {
          throw new XmlSyntaxError('Undeclared prefix');
        }
        attributes[attribute.name] = attribute;
      }
      const tag: XmlTag = { name, local, uri: uri ?? '', attributes, selfClosing };
      if (stack.length === 0) roots++;
      handlers.opentag(tag);
      if (selfClosing) {
        handlers.closetag(tag);
      } else {
        stack.push({ tag, scope: tagScope });
        scope = tagScope;
      }
      pos = at;
    }
  }
  if (stack.length > 0) throw new XmlSyntaxError('Unclosed element');
  if (roots === 0) throw new XmlSyntaxError('No root element');
}
