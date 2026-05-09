/**
 * Sidebar navigation. Edit this file to add/remove/reorder pages —
 * Layout.tsx renders it as the left rail of every doc page.
 */
export interface SidebarLink {
  readonly href: string;
  readonly label: string;
}

export interface SidebarSection {
  readonly title: string;
  readonly links: readonly SidebarLink[];
}

export const sidebarSections: readonly SidebarSection[] = [
  {
    title: 'Get Started',
    links: [
      { href: '/docs/get-started/introduction', label: 'Introduction' },
      { href: '/docs/get-started/why', label: 'Why nest-warden?' },
      { href: '/docs/get-started/when-to-use', label: 'When (not) to use' },
      { href: '/docs/get-started/installation', label: 'Installation' },
      { href: '/docs/get-started/faq', label: 'FAQ' },
    ],
  },
  {
    title: 'Core Concepts',
    links: [
      { href: '/docs/core-concepts/tenant-context', label: 'Tenant Context' },
      { href: '/docs/core-concepts/tenant-builder', label: 'Tenant-aware Builder' },
      { href: '/docs/core-concepts/cross-tenant', label: 'Cross-tenant Opt-out' },
      { href: '/docs/core-concepts/conditional-authorization', label: 'Conditional Authorization' },
      { href: '/docs/core-concepts/relationship-graph', label: 'Relationship Graph' },
      { href: '/docs/core-concepts/related-to', label: '$relatedTo Operator' },
      { href: '/docs/core-concepts/forward-vs-reverse', label: 'Forward vs Reverse Lookups' },
    ],
  },
  {
    title: 'Integration Guides',
    links: [
      { href: '/docs/integration/nestjs', label: 'NestJS' },
      { href: '/docs/integration/typeorm', label: 'TypeORM' },
      { href: '/docs/integration/rls-postgres', label: 'Postgres RLS' },
      { href: '/docs/integration/migration-from-casl', label: 'Migrate from @casl/ability' },
      { href: '/docs/integration/migration-from-prisma', label: 'Migrate from @casl/prisma' },
    ],
  },
  {
    title: 'Advanced Concepts',
    links: [
      { href: '/docs/advanced/security-best-practices', label: 'Security Best Practices' },
      { href: '/docs/advanced/custom-resolvers', label: 'Custom Relationship Resolvers' },
      { href: '/docs/advanced/multi-hop-design', label: 'Multi-hop Graph Design' },
      { href: '/docs/advanced/audit-logging', label: 'Audit Logging' },
      { href: '/docs/advanced/performance', label: 'Performance' },
      { href: '/docs/advanced/testing', label: 'Testing Strategies' },
      { href: '/docs/advanced/recipes', label: 'Recipes' },
    ],
  },
  {
    title: 'Reference',
    links: [
      { href: '/docs/api/overview', label: 'API Overview' },
    ],
  },
  {
    title: 'Roadmap',
    links: [
      { href: '/docs/roadmap/things-to-do', label: 'Things to do' },
      { href: '/docs/roadmap/rfcs/001-roles', label: 'RFC 001: Roles' },
    ],
  },
];
