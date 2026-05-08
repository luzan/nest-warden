/**
 * Custom Markdoc tags. Authoring docs in plain Markdown is the default;
 * use these tags only when standard Markdown can't express the intent.
 *
 * Available tags:
 *   - {% callout type="note" | "warning" | "tip" | "danger" %} ... {% /callout %}
 *   - {% tabs %} {% tab label="..." %}...{% /tab %} {% /tabs %}
 *
 * Render values are direct React component references — see the
 * comment in `nodes.ts` for the typing rationale.
 */
import type { Schema, Config } from '@markdoc/markdoc';
import type { ComponentType } from 'react';
import { Callout } from '../components/Callout';
import { Tabs, Tab } from '../components/Tabs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReactSchema = Schema<Config, ComponentType<any>>;

const callout: ReactSchema = {
  render: Callout,
  attributes: {
    type: {
      type: String,
      default: 'note',
      matches: ['note', 'warning', 'tip', 'danger'],
      errorLevel: 'critical',
    },
    title: { type: String },
  },
};

const tabs: ReactSchema = {
  render: Tabs,
  attributes: {},
};

const tab: ReactSchema = {
  render: Tab,
  attributes: {
    label: { type: String, required: true },
  },
};

const tags = { callout, tabs, tab };
export default tags;
