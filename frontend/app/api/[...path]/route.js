const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:3001';

async function proxy(request, context) {
  const { path } = await context.params;
  const target = new URL(`${backendUrl.replace(/\/$/, '')}/api/${path.join('/')}`);
  target.search = new URL(request.url).search;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length');
  headers.set('authorization', `Bearer ${process.env.PROCURA_API_KEY || ''}`);

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();

  const response = await fetch(target.toString(), {
    method: request.method,
    headers,
    body,
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
