import { createDatadogProxy } from 'nextjs-datadog/proxy';

export const proxy = createDatadogProxy();

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|og.png).*)'],
};
