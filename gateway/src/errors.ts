export class GatewayError extends Error {
  constructor(public code: string, public status: 400 | 404 | 409 | 410 | 413 | 422 | 429 | 502 | 503 | 504 = 502) { super(code); }
}
