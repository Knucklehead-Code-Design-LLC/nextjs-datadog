import { trace, SpanStatusCode } from '@opentelemetry/api';
import axios from 'axios';

import { demoLogger } from '../../../lib/demo-logger';

type Scenario = 'failure' | 'success';
type Target = 'github' | 'local';
type Transport = 'axios' | 'fetch';

const demoTracer = trace.getTracer('nextjs-datadog-demo');

interface DemoRequest {
  scenario: Scenario;
  target: Target;
  transport: Transport;
}

const isDemoRequest = (value: unknown): value is DemoRequest => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<DemoRequest>;
  const validScenario = candidate.scenario === 'success' || candidate.scenario === 'failure';
  const validTarget = candidate.target === 'local' || candidate.target === 'github';
  const validTransport = candidate.transport === 'fetch' || candidate.transport === 'axios';

  return validScenario && validTarget && validTransport;
};

const createTargetUrl = (request: Request, demoRequest: DemoRequest): string => {
  if (demoRequest.target === 'github') {
    if (demoRequest.scenario === 'failure') {
      return 'https://api.github.com/repos/vercel/this-repository-does-not-exist';
    }

    return 'https://api.github.com/repos/vercel/next.js';
  }

  if (demoRequest.scenario === 'failure') {
    return new URL('/api/upstream?scenario=failure', request.url).toString();
  }

  return new URL('/api/upstream', request.url).toString();
};

const callWithFetch = async (url: string): Promise<unknown> => {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      accept: 'application/vnd.github+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Upstream fetch failed with status ${String(response.status)}`);
  }

  return response.json() as Promise<unknown>;
};

const callWithAxios = async (url: string): Promise<unknown> => {
  const response = await axios.get<unknown>(url, {
    headers: {
      accept: 'application/vnd.github+json',
    },
    timeout: 5_000,
  });

  return response.data;
};

const callUpstream = async (demoRequest: DemoRequest, url: string): Promise<unknown> => {
  if (demoRequest.transport === 'axios') {
    return callWithAxios(url);
  }

  return callWithFetch(url);
};

const createResultSummary = (target: Target, value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') {
    return { received: true };
  }

  const record = value as Record<string, unknown>;
  if (target === 'github') {
    return {
      description: record.description,
      repository: record.full_name,
      stars: record.stargazers_count,
    };
  }

  return {
    message: record.message,
    requestId: record.requestId,
    traceContextReceived: record.traceContextReceived,
  };
};

const logStart = (demoRequest: DemoRequest): void => {
  demoLogger.info('Starting outbound request', {
    attributes: {
      'demo.scenario': demoRequest.scenario,
      'demo.target': demoRequest.target,
      'demo.transport': demoRequest.transport,
    },
  });
};

const logSuccess = (demoRequest: DemoRequest, durationMs: number): void => {
  demoLogger.info('Outbound request completed', {
    attributes: {
      'demo.duration_ms': durationMs,
      'demo.scenario': demoRequest.scenario,
      'demo.target': demoRequest.target,
      'demo.transport': demoRequest.transport,
    },
  });
};

const normalizeCaughtError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }

  return new Error('Outbound request failed');
};

const reportFailure = (demoRequest: DemoRequest, error: Error, durationMs: number): void => {
  demoLogger.error('Outbound request failed', {
    attributes: {
      'demo.duration_ms': durationMs,
      'demo.scenario': demoRequest.scenario,
      'demo.target': demoRequest.target,
      'demo.transport': demoRequest.transport,
    },
    error,
  });

  const span = trace.getActiveSpan();
  span?.recordException(error);
  span?.setStatus({
    code: SpanStatusCode.ERROR,
    message: error.message,
  });
};

const runDemoRequest = async (request: Request, demoRequest: DemoRequest): Promise<Response> => {
  const startedAt = performance.now();
  const targetUrl = createTargetUrl(request, demoRequest);
  logStart(demoRequest);

  try {
    const result = await callUpstream(demoRequest, targetUrl);
    const durationMs = Math.round(performance.now() - startedAt);
    logSuccess(demoRequest, durationMs);
    trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.OK });

    return Response.json({
      durationMs,
      result: createResultSummary(demoRequest.target, result),
    });
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    const normalizedError = normalizeCaughtError(error);
    reportFailure(demoRequest, normalizedError, durationMs);

    return Response.json(
      {
        durationMs,
        error: normalizedError.message,
      },
      { status: 502 },
    );
  }
};

const runPreviewTrace = async (request: Request, demoRequest: DemoRequest): Promise<Response> => {
  return demoTracer.startActiveSpan(
    'demo outbound request',
    {
      attributes: {
        'demo.preview': true,
        'demo.scenario': demoRequest.scenario,
        'demo.target': demoRequest.target,
        'demo.transport': demoRequest.transport,
      },
    },
    async (span) => {
      try {
        return await runDemoRequest(request, demoRequest);
      } finally {
        span.end();
      }
    },
  );
};

export const POST = async (request: Request): Promise<Response> => {
  const value: unknown = await request.json();
  if (!isDemoRequest(value)) {
    return Response.json({ error: 'Invalid demo request' }, { status: 400 });
  }

  return runPreviewTrace(request, value);
};
