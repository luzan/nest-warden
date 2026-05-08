import type { AppProps } from 'next/app';
import Markdoc from '@markdoc/markdoc';
import { Layout } from '../components/Layout';
import { Callout } from '../components/Callout';
import { Tabs, Tab } from '../components/Tabs';
import { CodeBlock } from '../components/CodeBlock';
import '../styles/globals.css';

/**
 * Pages whose default export is a Markdoc document expose
 * `markdoc.frontmatter` so we can pull the page title for the document
 * `<title>` and the layout heading.
 */
type MarkdocPageProps = {
  markdoc?: {
    frontmatter?: Record<string, unknown>;
    content?: ReturnType<typeof Markdoc.transform>;
  };
};

const components = {
  Callout,
  Tabs,
  Tab,
  CodeBlock,
};

export default function App({ Component, pageProps }: AppProps<MarkdocPageProps>): JSX.Element {
  const frontmatter = pageProps.markdoc?.frontmatter;
  const title = typeof frontmatter?.title === 'string' ? frontmatter.title : undefined;

  return (
    <Layout title={title}>
      <Component {...pageProps} components={components} />
    </Layout>
  );
}
