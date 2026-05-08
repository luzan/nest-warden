import type { ReactNode } from 'react';

/**
 * Renders a {% callout %} Markdoc tag as a styled aside box. Four
 * semantic variants keep documentation tone consistent across pages.
 */
export type CalloutType = 'note' | 'warning' | 'tip' | 'danger';

const styles: Record<CalloutType, { border: string; bg: string; label: string; icon: string }> = {
  note: { border: '#3b82f6', bg: '#eff6ff', label: 'Note', icon: 'ℹ' },
  warning: { border: '#f59e0b', bg: '#fffbeb', label: 'Warning', icon: '!' },
  tip: { border: '#10b981', bg: '#ecfdf5', label: 'Tip', icon: '✓' },
  danger: { border: '#ef4444', bg: '#fef2f2', label: 'Danger', icon: '×' },
};

export interface CalloutProps {
  type?: CalloutType;
  title?: string;
  children?: ReactNode;
}

export function Callout({ type = 'note', title, children }: CalloutProps): JSX.Element {
  const s = styles[type];
  return (
    <aside
      role="note"
      style={{
        borderLeft: `4px solid ${s.border}`,
        background: s.bg,
        padding: '0.75rem 1rem',
        margin: '1.25rem 0',
        borderRadius: 4,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
        <span style={{ marginRight: '0.5rem' }}>{s.icon}</span>
        {title ?? s.label}
      </div>
      <div>{children}</div>
    </aside>
  );
}
