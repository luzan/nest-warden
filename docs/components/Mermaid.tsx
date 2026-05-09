import { useEffect, useState } from 'react';

/**
 * Renders a Mermaid diagram from its source. Client-only on purpose:
 * the mermaid library touches `document` at import time and breaks
 * SSR/static-export. The site's CodeBlock detects the `mermaid`
 * language tag and lazy-loads this component via `next/dynamic` with
 * `ssr: false`, so the static export emits a placeholder and the
 * client takes over after hydration.
 *
 * Pass the diagram source as `source`. Whitespace is preserved.
 */
export interface MermaidProps {
  source: string;
}

const Mermaid = ({ source }: MermaidProps): JSX.Element => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;

    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          // `strict` disables flowchart htmlLabels (which use
          // dangerouslySetInnerHTML); we trust authored content but
          // keep the strict default since the diagrams here don't need
          // raw HTML in node labels.
          securityLevel: 'strict',
          fontFamily: 'system-ui, sans-serif',
        });
        const result = await mermaid.render(id, source);
        if (!canceled) setSvg(result.svg);
      } catch (err) {
        if (!canceled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [source]);

  if (error) {
    return (
      <div
        style={{
          background: '#fef2f2',
          border: '1px solid #fca5a5',
          borderRadius: 4,
          padding: '0.75rem 1rem',
          margin: '1rem 0',
          fontFamily: 'ui-monospace, monospace',
          fontSize: '0.85rem',
          color: '#991b1b',
        }}
      >
        <strong>Mermaid render error:</strong> {error}
        <pre style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>{source}</pre>
      </div>
    );
  }

  if (!svg) {
    // Initial render before useEffect runs (or during static export).
    // Show the source as a code block placeholder.
    return (
      <pre
        style={{
          background: '#f3f4f6',
          padding: '1rem',
          borderRadius: 4,
          margin: '1rem 0',
          fontSize: '0.85rem',
          overflow: 'auto',
        }}
      >
        <code>{source}</code>
      </pre>
    );
  }

  return (
    <div
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{
        margin: '1.5rem 0',
        textAlign: 'center',
        background: '#ffffff',
        padding: '1rem',
        borderRadius: 6,
        border: '1px solid #e5e7eb',
        overflowX: 'auto',
      }}
    />
  );
};

export default Mermaid;
