const wait = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

export const dynamic = 'force-dynamic';

export const GET = async (request: Request): Promise<Response> => {
  await wait(180);

  const requestUrl = new URL(request.url);
  if (requestUrl.searchParams.get('scenario') === 'failure') {
    return Response.json(
      {
        error: 'Intentional upstream failure',
      },
      { status: 503 },
    );
  }

  const requestId = request.headers.get('x-request-id');
  const traceparent = request.headers.get('traceparent');

  return Response.json({
    message: 'Deterministic local upstream response',
    requestId,
    traceContextReceived: Boolean(traceparent),
  });
};
