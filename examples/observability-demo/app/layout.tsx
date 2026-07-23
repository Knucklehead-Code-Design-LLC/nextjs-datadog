import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  description:
    'Run fetch and Axios requests through Next.js and inspect the correlated logs and OpenTelemetry spans nextjs-datadog produces.',
  metadataBase: new URL('http://localhost:3000'),
  openGraph: {
    description: 'A local flight recorder for Next.js server observability.',
    images: ['/og.png'],
    title: 'nextjs-datadog observability lab',
  },
  title: 'nextjs-datadog · observability lab',
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): ReactNode {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
