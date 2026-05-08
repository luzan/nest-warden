import { Children, isValidElement, useState, type ReactNode } from 'react';

/**
 * Two simple tab components rendered from `{% tabs %}` / `{% tab %}`
 * Markdoc tags. The first tab is selected by default; the user can
 * click any other to switch. Pure React state, no router coupling.
 */
export interface TabsProps {
  children?: ReactNode;
}

export interface TabProps {
  label: string;
  children?: ReactNode;
}

export function Tab({ children }: TabProps): JSX.Element {
  return <div>{children}</div>;
}

export function Tabs({ children }: TabsProps): JSX.Element {
  const tabs = Children.toArray(children).filter(isValidElement) as Array<
    React.ReactElement<TabProps>
  >;
  const [active, setActive] = useState(0);

  return (
    <div style={{ margin: '1.25rem 0' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
        {tabs.map((tab, idx) => (
          <button
            key={tab.props.label}
            type="button"
            onClick={() => setActive(idx)}
            style={{
              padding: '0.5rem 1rem',
              border: 'none',
              borderBottom: active === idx ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              fontWeight: active === idx ? 600 : 400,
              color: active === idx ? '#1f2937' : '#6b7280',
            }}
          >
            {tab.props.label}
          </button>
        ))}
      </div>
      <div style={{ paddingTop: '1rem' }}>{tabs[active]}</div>
    </div>
  );
}
