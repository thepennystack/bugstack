export type ErrorBody = {
  reason: string;
  message: string;
};

export type Me = {
  email: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;
  readonly request: string;

  constructor(request: string, status: number, body: ErrorBody) {
    super(`${request} answered ${status} ${body.reason}: ${body.message}`);
    this.name = "ApiError";
    this.request = request;
    this.status = status;
    this.body = body;
  }
}

type Guard<T> = (value: unknown) => value is T;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isErrorBody: Guard<ErrorBody> = (value): value is ErrorBody =>
  isRecord(value) && typeof value.reason === "string" && typeof value.message === "string";

const isMe: Guard<Me> = (value): value is Me => isRecord(value) && typeof value.email === "string";

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text === "") return undefined;
  return JSON.parse(text);
};

const failureBody = async (response: Response): Promise<ErrorBody> => {
  const body = await readJson(response).catch(() => undefined);
  if (isErrorBody(body)) return body;
  return { reason: "HttpError", message: `${response.status} ${response.statusText}`.trim() };
};

export const isUnauthorized = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;

const request = async <T>(
  method: string,
  path: string,
  guard: Guard<T>,
  body?: unknown,
): Promise<T> => {
  const label = `${method} ${path}`;
  const init: RequestInit = {
    method,
    redirect: "manual",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  };
  if (body !== undefined) {
    init.headers = { accept: "application/json", "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.type === "opaqueredirect") {
    throw new ApiError(label, 401, {
      reason: "Unauthorized",
      message: "Cloudflare Access redirected the request to sign in",
    });
  }
  if (!response.ok) throw new ApiError(label, response.status, await failureBody(response));
  const data = await readJson(response);
  if (!guard(data)) {
    throw new ApiError(label, response.status, {
      reason: "UnexpectedResponse",
      message: `the response does not match the expected shape: ${JSON.stringify(data)}`,
    });
  }
  return data;
};

export const getMe = (): Promise<Me> => request("GET", "/api/me", isMe);
