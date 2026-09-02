// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// XML → DOM adapter for the gesetze-im-internet.de legal-text exports
// (gii-norm.dtd) under data/input/.
//
// Parsing is delegated to `fast-xml-parser` (MIT, a devDependency — the
// fee-schedule generator is build-side tooling and never shipped, so it is
// outside the license gate's scope, see scripts/check-licenses.mjs). This
// module only maps its `preserveOrder` output onto the node shape the fee
// builder walks and adds the traversal helpers.
//
// Nodes are `{ name, attrs, children }` for elements and
// `{ name: '#text', text }` for text. Use `text(node)` to get the
// concatenated text content.

import { XMLParser } from 'fast-xml-parser';

// `preserveOrder` keeps mixed content (running text interleaved with <B>/<I>)
// in document order, which the position parser relies on. Values stay verbatim
// strings: no trimming, no number coercion — `clean()` in the builder decides.
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  ignorePiTags: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

/** Map fast-xml-parser's `preserveOrder` entries onto `{ name, attrs, children }`. */
function toNodes(entries) {
  const out = [];
  for (const entry of entries) {
    const name = Object.keys(entry).find((k) => k !== ':@');
    if (name === undefined) continue;
    if (name === '#text') {
      out.push({ name: '#text', text: String(entry['#text']) });
      continue;
    }
    out.push({ name, attrs: entry[':@'] ?? {}, children: toNodes(entry[name] ?? []) });
  }
  return out;
}

/** Parse an XML string into a synthetic `#root` element. */
export function parseXml(xml) {
  return { name: '#root', attrs: {}, children: toNodes(parser.parse(xml)) };
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
