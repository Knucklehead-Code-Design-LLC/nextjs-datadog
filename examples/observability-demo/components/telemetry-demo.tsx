'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

type Scenario = 'failure' | 'success';
type Target = 'github' | 'local';
type Transport = 'axios' | 'fetch';
type View = 'logs' | 'raw' | 'spans';

interface PreviewLog {
  [key: string]: unknown;
  level: string;
  message: string;
  span_id?: string;
  timestamp: string;
  trace_id?: string;
}

interface PreviewSpan {
  attributes: Readonly<Record<string, boolean | number | string>>;
  durationMs: number;
  kind: string;
  name: string;
  parentSpanId?: string;
  spanId: string;
  status: string;
  timestamp: string;
  traceId: string;
}

interface TelemetrySnapshot {
  logs: PreviewLog[];
  spans: PreviewSpan[];
}

interface RunOutcome {
  durationMs?: number;
  error?: string;
  result?: unknown;
}

const EMPTY_SNAPSHOT: TelemetrySnapshot = {
  logs: [],
  spans: [],
};

const formatIdentifier = (identifier: string | undefined): string => {
  if (!identifier) {
    return 'not attached';
  }

  return identifier;
};

const formatTime = (timestamp: string): string => {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
};

const getSpanStatusClass = (status: string): string => {
  if (status === 'error') {
    return 'status status-error';
  }

  return 'status status-ok';
};

const getLogLevelClass = (level: string): string => {
  if (level === 'error') {
    return 'status status-error';
  }

  if (level === 'warn') {
    return 'status status-warn';
  }

  return 'status status-info';
};

const TabButton = ({
  activeView,
  count,
  label,
  value,
  onChange,
}: {
  activeView: View;
  count?: number;
  label: string;
  value: View;
  onChange: (value: View) => void;
}): ReactNode => {
  let className = 'tab';
  if (activeView === value) {
    className += ' tab-active';
  }

  return (
    <button className={className} onClick={() => onChange(value)} type="button">
      {label}
      {count !== undefined && <span>{count}</span>}
    </button>
  );
};

const SpanList = ({ spans }: { spans: PreviewSpan[] }): ReactNode => {
  if (spans.length === 0) {
    return <EmptyState kind="spans" />;
  }

  return (
    <div className="telemetry-list">
      {spans.map((span) => (
        <article className="span-card" key={`${span.spanId}-${span.timestamp}`}>
          <div className="record-heading">
            <span className={getSpanStatusClass(span.status)}>{span.status}</span>
            <strong>{span.name}</strong>
            <time>{formatTime(span.timestamp)}</time>
          </div>
          <div className="waterfall-track">
            <span
              style={{ width: `${String(Math.min(Math.max(span.durationMs / 6, 4), 100))}%` }}
            />
          </div>
          <dl className="record-grid">
            <div>
              <dt>duration</dt>
              <dd>{span.durationMs} ms</dd>
            </div>
            <div>
              <dt>kind</dt>
              <dd>{span.kind}</dd>
            </div>
            <div>
              <dt>trace_id</dt>
              <dd>{span.traceId}</dd>
            </div>
            <div>
              <dt>span_id</dt>
              <dd>{span.spanId}</dd>
            </div>
            <div>
              <dt>parent_span_id</dt>
              <dd>{formatIdentifier(span.parentSpanId)}</dd>
            </div>
          </dl>
          {Object.keys(span.attributes).length > 0 && (
            <pre className="attributes">{JSON.stringify(span.attributes, null, 2)}</pre>
          )}
        </article>
      ))}
    </div>
  );
};

const LogList = ({ logs }: { logs: PreviewLog[] }): ReactNode => {
  if (logs.length === 0) {
    return <EmptyState kind="logs" />;
  }

  return (
    <div className="telemetry-list">
      {logs.map((log, index) => (
        <article className="log-card" key={`${log.timestamp}-${String(index)}`}>
          <div className="record-heading">
            <span className={getLogLevelClass(log.level)}>{log.level}</span>
            <strong>{log.message}</strong>
            <time>{formatTime(log.timestamp)}</time>
          </div>
          <dl className="record-grid">
            <div>
              <dt>trace_id</dt>
              <dd>{formatIdentifier(log.trace_id)}</dd>
            </div>
            <div>
              <dt>span_id</dt>
              <dd>{formatIdentifier(log.span_id)}</dd>
            </div>
          </dl>
          <pre className="attributes">{JSON.stringify(log, null, 2)}</pre>
        </article>
      ))}
    </div>
  );
};

const EmptyState = ({ kind }: { kind: 'logs' | 'spans' }): ReactNode => {
  return (
    <div className="empty-state">
      <span>◇</span>
      <strong>No {kind} captured yet</strong>
      <p>Run a request from the control panel. New telemetry appears here automatically.</p>
    </div>
  );
};

const RawView = ({ snapshot }: { snapshot: TelemetrySnapshot }): ReactNode => {
  return <pre className="raw-view">{JSON.stringify(snapshot, null, 2)}</pre>;
};

const Outcome = ({ outcome }: { outcome: RunOutcome | undefined }): ReactNode => {
  if (!outcome) {
    return null;
  }

  if (outcome.error) {
    return (
      <div className="outcome outcome-error">
        <strong>Expected failure captured</strong>
        <span>{outcome.error}</span>
      </div>
    );
  }

  return (
    <div className="outcome outcome-success">
      <strong>Request completed in {outcome.durationMs} ms</strong>
      <span>Inspect the shared IDs in the telemetry stream below.</span>
    </div>
  );
};

const TelemetryPanel = ({
  snapshot,
  view,
  onViewChange,
}: {
  snapshot: TelemetrySnapshot;
  view: View;
  onViewChange: (view: View) => void;
}): ReactNode => {
  let content: ReactNode = <SpanList spans={snapshot.spans} />;
  if (view === 'logs') {
    content = <LogList logs={snapshot.logs} />;
  }
  if (view === 'raw') {
    content = <RawView snapshot={snapshot} />;
  }

  return (
    <section className="stream-panel">
      <div className="stream-heading">
        <div>
          <p className="eyebrow">Live preview</p>
          <h2>Telemetry stream</h2>
        </div>
        <div className="live-indicator">
          <span />
          polling
        </div>
      </div>
      <div className="tabs" role="tablist">
        <TabButton
          activeView={view}
          count={snapshot.spans.length}
          label="Spans"
          onChange={onViewChange}
          value="spans"
        />
        <TabButton
          activeView={view}
          count={snapshot.logs.length}
          label="Logs"
          onChange={onViewChange}
          value="logs"
        />
        <TabButton activeView={view} label="Raw JSON" onChange={onViewChange} value="raw" />
      </div>
      {content}
    </section>
  );
};

const RequestControls = ({
  busy,
  scenario,
  target,
  onClear,
  onRun,
  onScenarioChange,
  onTargetChange,
}: {
  busy: Transport | undefined;
  scenario: Scenario;
  target: Target;
  onClear: () => void;
  onRun: (transport: Transport) => void;
  onScenarioChange: (scenario: Scenario) => void;
  onTargetChange: (target: Target) => void;
}): ReactNode => {
  const isBusy = busy !== undefined;

  return (
    <section className="control-panel">
      <div className="control-title">
        <span className="step">01</span>
        <div>
          <p className="eyebrow">Request generator</p>
          <h2>Send a server-side request</h2>
        </div>
      </div>
      <label>
        Target
        <select onChange={(event) => onTargetChange(event.target.value as Target)} value={target}>
          <option value="local">Local deterministic API</option>
          <option value="github">Public GitHub API</option>
        </select>
      </label>
      <label>
        Scenario
        <select
          onChange={(event) => onScenarioChange(event.target.value as Scenario)}
          value={scenario}
        >
          <option value="success">Successful response</option>
          <option value="failure">Upstream failure</option>
        </select>
      </label>
      <div className="run-buttons">
        <button disabled={isBusy} onClick={() => onRun('fetch')} type="button">
          <span>Run with</span>
          {busy === 'fetch' && <strong>Running…</strong>}
          {busy !== 'fetch' && <strong>fetch()</strong>}
        </button>
        <button disabled={isBusy} onClick={() => onRun('axios')} type="button">
          <span>Run with</span>
          {busy === 'axios' && <strong>Running…</strong>}
          {busy !== 'axios' && <strong>Axios</strong>}
        </button>
      </div>
      <button className="clear-button" onClick={onClear} type="button">
        Clear telemetry
      </button>
      <p className="control-note">
        The local target is deterministic. GitHub is optional and subject to its unauthenticated API
        rate limit.
      </p>
    </section>
  );
};

const Hero = ({ traceCount }: { traceCount: number }): ReactNode => {
  return (
    <header className="hero">
      <nav>
        <a
          className="wordmark"
          href="https://github.com/Knucklehead-Code-Design-LLC/nextjs-datadog"
        >
          nextjs<span>/</span>datadog
        </a>
        <span className="lab-badge">observability lab</span>
      </nav>
      <div className="hero-grid">
        <div>
          <p className="eyebrow">Next.js · OpenTelemetry · Datadog</p>
          <h1>See what your server is doing.</h1>
          <p className="hero-copy">
            Run a request, follow its spans, and inspect the exact structured logs that can flow
            into Datadog—without sending this preview anywhere.
          </p>
        </div>
        <div className="signal-card">
          <span className="signal-dot" />
          <div>
            <strong>Local recorder active</strong>
            <span>bounded · in-memory · redacted</span>
          </div>
          <div className="signal-metric">
            <strong>{traceCount}</strong>
            <span>traces</span>
          </div>
        </div>
      </div>
    </header>
  );
};

const CorrelationStrip = (): ReactNode => {
  return (
    <section className="correlation-strip">
      <span className="step">02</span>
      <div>
        <p className="eyebrow">Correlation path</p>
        <h2>One context, carried across every hop</h2>
      </div>
      <ol>
        <li>
          <span>RUM</span>
          Browser action
        </li>
        <li>
          <span>Next.js</span>
          Server route
        </li>
        <li>
          <span>OTel</span>
          fetch / Axios
        </li>
        <li>
          <span>Datadog</span>
          Backend service
        </li>
      </ol>
    </section>
  );
};

const DemoFooter = (): ReactNode => {
  return (
    <footer>
      <p>
        Preview storage never includes request bodies, cookies, authorization headers, or raw query
        strings.
      </p>
      <span>Built to make the invisible inspectable.</span>
    </footer>
  );
};

interface TelemetryDemoState {
  busy: Transport | undefined;
  clear: () => Promise<void>;
  outcome: RunOutcome | undefined;
  run: (transport: Transport) => Promise<void>;
  scenario: Scenario;
  setScenario: (scenario: Scenario) => void;
  setTarget: (target: Target) => void;
  setView: (view: View) => void;
  snapshot: TelemetrySnapshot;
  target: Target;
  traceCount: number;
  view: View;
}

const useTelemetryDemo = (): TelemetryDemoState => {
  const [busy, setBusy] = useState<Transport>();
  const [outcome, setOutcome] = useState<RunOutcome>();
  const [scenario, setScenario] = useState<Scenario>('success');
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot>(EMPTY_SNAPSHOT);
  const [target, setTarget] = useState<Target>('local');
  const [view, setView] = useState<View>('spans');

  const refresh = useCallback(async (): Promise<void> => {
    const response = await fetch('/api/telemetry', { cache: 'no-store' });
    if (response.ok) {
      setSnapshot((await response.json()) as TelemetrySnapshot);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 1_500);

    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = useCallback(
    async (transport: Transport): Promise<void> => {
      setBusy(transport);
      setOutcome(undefined);

      try {
        const response = await fetch('/api/demo', {
          body: JSON.stringify({ scenario, target, transport }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
        setOutcome((await response.json()) as RunOutcome);
      } finally {
        setBusy(undefined);
        await refresh();
      }
    },
    [refresh, scenario, target],
  );

  const clear = useCallback(async (): Promise<void> => {
    await fetch('/api/telemetry', { method: 'DELETE' });
    setOutcome(undefined);
    await refresh();
  }, [refresh]);

  const traceCount = useMemo(() => {
    return new Set(snapshot.spans.map((span) => span.traceId)).size;
  }, [snapshot.spans]);

  return {
    busy,
    clear,
    outcome,
    run,
    scenario,
    setScenario,
    setTarget,
    setView,
    snapshot,
    target,
    traceCount,
    view,
  };
};

export const TelemetryDemo = (): ReactNode => {
  const state = useTelemetryDemo();

  return (
    <main>
      <Hero traceCount={state.traceCount} />
      <div className="workspace">
        <RequestControls
          busy={state.busy}
          onClear={() => void state.clear()}
          onRun={(transport) => void state.run(transport)}
          onScenarioChange={state.setScenario}
          onTargetChange={state.setTarget}
          scenario={state.scenario}
          target={state.target}
        />
        <div className="stream-column">
          <Outcome outcome={state.outcome} />
          <TelemetryPanel
            onViewChange={state.setView}
            snapshot={state.snapshot}
            view={state.view}
          />
        </div>
      </div>
      <CorrelationStrip />
      <DemoFooter />
    </main>
  );
};
