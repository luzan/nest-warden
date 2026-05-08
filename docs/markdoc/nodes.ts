/**
 * Markdoc nodes — overrides for standard Markdown elements (heading,
 * fence, link, etc.). The @markdoc/next.js plugin picks this file up
 * automatically when `schemaPath` points at the `markdoc/` directory.
 *
 * `Schema<Config, R>` is generic on the render-value type with default
 * `R = string`. We instantiate with `ComponentType<any>` so `render`
 * accepts a React component reference directly — no string-name +
 * components-map indirection that triggers the
 * `<CodeBlock /> incorrect casing` React warning.
 */
import type { Schema, Config } from '@markdoc/markdoc';
import type { ComponentType } from 'react';
import { CodeBlock } from '../components/CodeBlock';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReactSchema = Schema<Config, ComponentType<any>>;

const fence: ReactSchema = {
  render: CodeBlock,
  attributes: {
    content: { type: String, render: false, required: true },
    language: { type: String },
  },
};

const nodes = { fence };
export default nodes;
