// SPDX-License-Identifier: Apache-2.0
//
// Minimal, dependency-free XML → DOM parser, just enough for the well-formed
// gesetze-im-internet.de legal-text exports (gii-norm.dtd) under data/input/.
//
// It is intentionally NOT a general-purpose XML parser: it skips the prolog,
// DOCTYPE and comments and assumes well-formed input (which the official
// exports are). Keeping the fee-schedule generator dependency-free matches the
// repo's tooling convention (see scripts/check-licenses.mjs).
//
// Nodes are `{ name, attrs, children }` for elements (name starts with a
// letter) and `{ name: '#text', text }` for text. Use `text(node)` to get the
// concatenated text content.

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decode XML entities (named + numeric, decimal and hex). */
export function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return e in NAMED_ENTITIES ? NAMED_ENTITIES[e] : m;
  });
}

/** Parse an XML string into a synthetic `#root` element. */
export function parseXml(xml) {
  const n = xml.length;
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  while (i < n) {
    if (xml[i] === '<') {
      if (xml.startsWith('<!--', i)) {
        const e = xml.indexOf('-->', i);
        i = e < 0 ? n : e + 3;
        continue;
      }
      if (xml.startsWith('<!', i) || xml.startsWith('<?', i)) {
        const e = xml.indexOf('>', i);
        i = e < 0 ? n : e + 1;
        continue;
      }
      if (xml[i + 1] === '/') {
        const e = xml.indexOf('>', i);
        const name = xml.slice(i + 2, e).trim();
        for (let s = stack.length - 1; s > 0; s--) {
          if (stack[s].name === name) {
            stack.length = s;
            break;
          }
        }
        i = e + 1;
        continue;
      }
      const e = xml.indexOf('>', i);
      let raw = xml.slice(i + 1, e);
      const selfClose = raw.endsWith('/');
      if (selfClose) raw = raw.slice(0, -1);
      const nameMatch = raw.match(/^([^\s/]+)/);
      const name = nameMatch ? nameMatch[1] : raw.trim();
      const attrs = {};
      const attrRe = /([^\s=]+)\s*=\s*"([^"]*)"|([^\s=]+)\s*=\s*'([^']*)'/g;
      let am;
      while ((am = attrRe.exec(raw))) {
        attrs[am[1] ?? am[3]] = decodeEntities(am[2] ?? am[4] ?? '');
      }
      const node = { name, attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!selfClose) stack.push(node);
      i = e + 1;
      continue;
    }
    const e = xml.indexOf('<', i);
    const slice = xml.slice(i, e < 0 ? n : e);
    if (slice)
      stack[stack.length - 1].children.push({ name: '#text', text: decodeEntities(slice) });
    i = e < 0 ? n : e;
  }
  return root;
}

/** True if the node is an element (not a text node). */
export function isElement(node) {
  return node && typeof node.name === 'string' && node.name[0] !== '#';
}

/** Concatenated text content of a node and its descendants. */
export function text(node) {
  if (!node) return '';
  if (node.name === '#text') return node.text;
  return (node.children || []).map(text).join('');
}

/** All descendant elements with the given tag name (pre-order). */
export function findAll(node, name, out = []) {
  for (const c of node.children || []) {
    if (isElement(c)) {
      if (c.name === name) out.push(c);
      findAll(c, name, out);
    }
  }
  return out;
}

/** First descendant element with the given tag name, or null. */
export function findFirst(node, name) {
  for (const c of node.children || []) {
    if (!isElement(c)) continue;
    if (c.name === name) return c;
    const deep = findFirst(c, name);
    if (deep) return deep;
  }
  return null;
}
