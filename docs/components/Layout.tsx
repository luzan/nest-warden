import Link from 'next/link';
import type { ReactNode } from 'react';
import { sidebarSections } from './sidebar.config';

/**
 * Shared layout that wraps every doc page. Two-column shell: a fixed
 * sidebar on the left listing every page, and the rendered Markdoc
 * content on the right.
 *
 * Uses inline styles to keep the example self-contained — a real docs
 * site would migrate to CSS modules or Tailwind.
 */
export interface LayoutProps {
  children?: ReactNode;
  title?: string;
}

export function Layout({ children, title }: LayoutProps): JSX.Element {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <aside
        style={{
          width: 280,
          borderRight: '1px solid #e5e7eb',
          padding: '1.5rem 1rem',
          background: '#f9fafb',
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflowY: 'auto',
        }}
      >
        <Link
          href="/"
          style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827', textDecoration: 'none' }}
        >
          nest-warden
        </Link>
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '1.5rem' }}>
          docs · v0.1.0-alpha
        </div>
        <nav>
          {sidebarSections.map((section) => (
            <div key={section.title} style={{ marginBottom: '1.25rem' }}>
              <div
                style={{
                  fontSize: '0.7rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: '#6b7280',
                  fontWeight: 700,
                  marginBottom: '0.4rem',
                }}
              >
                {section.title}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      style={{
                        display: 'block',
                        padding: '0.25rem 0',
                        color: '#374151',
                        textDecoration: 'none',
                        fontSize: '0.9rem',
                      }}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <main
        style={{
          flex: 1,
          maxWidth: 880,
          padding: '2.5rem 3rem',
          color: '#1f2937',
          lineHeight: 1.65,
        }}
      >
        {title ? <h1 style={{ marginTop: 0 }}>{title}</h1> : null}
        {children}
      </main>
    </div>
  );
}
