import { http, HttpResponse, type HttpHandler } from 'msw';
import { setupServer } from 'msw/node';

export const mswServer = setupServer();

export interface CapturedRequest {
  readonly request: Request;
  readonly url: URL;
}

export function jsonFixture(
  url: string | RegExp,
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): HttpHandler {
  return http.all(
    url,
    () =>
      new HttpResponse(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      }),
  );
}

export function sseFixture(
  url: string | RegExp,
  events: readonly (string | Readonly<Record<string, unknown>>)[],
  status = 200,
): HttpHandler {
  const encoder = new TextEncoder();
  const body = events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');
  return http.all(
    url,
    () =>
      new HttpResponse(encoder.encode(body), {
        status,
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
      }),
  );
}

export function captureRequest(
  url: string | RegExp,
  onRequest: (captured: CapturedRequest) => void,
  response: () => Response | Promise<Response>,
): HttpHandler {
  return http.all(url, async ({ request }) => {
    onRequest({ request, url: new URL(request.url) });
    return response();
  });
}

export function stalledResponse(url: string | RegExp): HttpHandler {
  const asError = (reason: unknown): Error =>
    reason instanceof Error ? reason : new DOMException('The request was aborted.', 'AbortError');
  return http.all(
    url,
    ({ request }) =>
      new Promise<Response>((_resolve, reject) => {
        if (request.signal.aborted) {
          reject(asError(request.signal.reason));
          return;
        }
        request.signal.addEventListener(
          'abort',
          () => {
            reject(asError(request.signal.reason));
          },
          { once: true },
        );
      }),
  );
}
