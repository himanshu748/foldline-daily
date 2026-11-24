export type ApiStatus = 400 | 401 | 403 | 404 | 409 | 500 | 502;

/** An error with a stable code the client can branch on and a sentence it can show. */
export class ApiError extends Error {
  readonly status: ApiStatus;
  readonly code: string;

  constructor(status: ApiStatus, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}
