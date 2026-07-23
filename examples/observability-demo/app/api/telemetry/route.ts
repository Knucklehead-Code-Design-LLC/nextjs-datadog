import { clearTelemetry, getTelemetrySnapshot } from '../../../lib/telemetry-store';

export const dynamic = 'force-dynamic';

export const GET = (): Response => {
  return Response.json(getTelemetrySnapshot(), {
    headers: {
      'cache-control': 'no-store',
    },
  });
};

export const DELETE = (): Response => {
  clearTelemetry();
  return Response.json({ cleared: true });
};
