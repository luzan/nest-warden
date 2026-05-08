import type { ReactNode } from 'react';

/**
 * Renders a fenced code block with the language tag and dark-theme
 * styling. Markdoc's default `fence` transform passes the code text as
 * **children** (not as a `content` prop), so this component reads
 * `children` to display the code.
 *
 * The `content` attribute on the schema (with `render: false`) is what
 * tells Markdoc to bypass the prop wiring and use the value as the
 * element's children — pre + content gets you a vanilla code block.
 *
 * The `language` attribute is rendered as `data-language` for
 * downstream syntax-highlighter integrations.
 */
export interface CodeBlockProps {
  language?: string;
  children?: ReactNode;
}

export function CodeBlock({ children, language }: CodeBlockProps): JSX.Element {
  return (
    <pre
      style={{
        background: '#0f172a',
        color: '#e2e8f0',
        padding: '1rem',
        borderRadius: 6,
        overflow: 'auto',
        margin: '1rem 0',
        fontSize: '0.875rem',
        lineHeight: 1.5,
      }}
      data-language={language ?? 'text'}
    >
      <code>{children}</code>
    </pre>
  );
}
