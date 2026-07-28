export const MAX_REQUEST_BODY_BYTES = 64 * 1024;

export class RequestBodyError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    message: string,
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

interface BodyRequest {
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
}

function assertJsonContentType(request: BodyRequest): void {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestBodyError(415, "content-type must be application/json");
  }
}

function assertedContentLength(request: BodyRequest, maxBytes: number): void {
  const rawLength = request.headers.get("content-length");
  if (rawLength === null) return;
  if (!/^\d+$/.test(rawLength)) throw new RequestBodyError(400, "invalid content-length");
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length)) throw new RequestBodyError(400, "invalid content-length");
  if (length > maxBytes) throw new RequestBodyError(413, "request body too large");
}

export async function readBoundedBody(
  request: BodyRequest,
  maxBytes = MAX_REQUEST_BODY_BYTES,
): Promise<Uint8Array> {
  assertJsonContentType(request);
  assertedContentLength(request, maxBytes);

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request body too large");
        throw new RequestBodyError(413, "request body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readBoundedJson(
  request: Request,
  maxBytes = MAX_REQUEST_BODY_BYTES,
): Promise<unknown> {
  const bytes = await readBoundedBody(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestBodyError(400, "request body must be valid JSON");
  }
}

export async function boundedJsonRequest(
  request: Request,
  maxBytes = MAX_REQUEST_BODY_BYTES,
): Promise<Request> {
  const body = await readBoundedBody(request, maxBytes);
  return new Request(request, { body });
}

export function bodyErrorResponse(error: RequestBodyError): Response {
  return Response.json({ error: error.message }, { status: error.status });
}
