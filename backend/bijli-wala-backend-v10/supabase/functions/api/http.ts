export const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, code: string) { super(code); this.status = status; }
}

export async function rawInput(req: Request, limit: number): Promise<Uint8Array> {
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new ApiError(413, "body_too_large"); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}

export async function objectInput(req: Request, limit = 4096): Promise<Record<string, unknown>> {
  if (req.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new ApiError(415, "json_required");
  const raw = await rawInput(req, limit);
  let body;
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new ApiError(400, "invalid_json"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "invalid_fields");
  return body;
}

export async function input(req: Request, fields: string[]): Promise<Record<string, string>> {
  const body = await objectInput(req);
  if (Object.keys(body).length !== fields.length || fields.some(f => typeof body[f] !== "string")) throw new ApiError(400, "invalid_fields");
  return body as Record<string, string>;
}
