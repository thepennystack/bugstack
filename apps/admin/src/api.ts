export type ErrorBody = {
  reason: string;
  message: string;
};

export type Me = {
  email: string;
};

export type ClientStatus = "Active" | "Revoked";

export type Slack = {
  workspaceId: string;
  channel: string;
};

export type App = {
  appId: string;
  name: string;
  description: string;
  installationId: number;
  githubRepo: string;
  slack: Slack | null;
  createdAt: string;
};

export type AppInput = {
  name: string;
  description: string;
  installationId: number;
  githubRepo: string;
};

export type Client = {
  clientId: string;
  name: string;
  status: ClientStatus;
  createdAt: string;
};

export type CreatedClient = Client & {
  secret: string;
};

export type AppDetail = {
  app: App;
  clients: Client[];
};

export type ReportStatus = "Pending" | "Filed" | "Failed";

export type FailureStep = "GitHub" | "Slack";

export type LastFailure = {
  failedAt: string;
  step: FailureStep;
  message: string;
};

export type ReportRow = {
  reportId: string;
  title: string;
  status: ReportStatus;
  attempts: number;
  receivedAt: string;
  clientName: string;
  nextAttemptAt: string;
  issueUrl: string | null;
  slackPosted: boolean;
  lastFailure: LastFailure | null;
};

export type Installation = {
  installationId: number;
  account: string;
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

const isSlack: Guard<Slack> = (value): value is Slack =>
  isRecord(value) && typeof value.workspaceId === "string" && typeof value.channel === "string";

const isApp: Guard<App> = (value): value is App =>
  isRecord(value) &&
  typeof value.appId === "string" &&
  typeof value.name === "string" &&
  typeof value.description === "string" &&
  typeof value.installationId === "number" &&
  typeof value.githubRepo === "string" &&
  (value.slack === null || isSlack(value.slack)) &&
  typeof value.createdAt === "string";

const isClient: Guard<Client> = (value): value is Client =>
  isRecord(value) &&
  typeof value.clientId === "string" &&
  typeof value.name === "string" &&
  (value.status === "Active" || value.status === "Revoked") &&
  typeof value.createdAt === "string";

const isCreatedClient: Guard<CreatedClient> = (value): value is CreatedClient =>
  isRecord(value) && typeof value.secret === "string" && isClient(value);

const isAppDetail: Guard<AppDetail> = (value): value is AppDetail =>
  isRecord(value) &&
  isApp(value.app) &&
  Array.isArray(value.clients) &&
  value.clients.every(isClient);

const isLastFailure: Guard<LastFailure> = (value): value is LastFailure =>
  isRecord(value) &&
  typeof value.failedAt === "string" &&
  (value.step === "GitHub" || value.step === "Slack") &&
  typeof value.message === "string";

const isReportRow: Guard<ReportRow> = (value): value is ReportRow =>
  isRecord(value) &&
  typeof value.reportId === "string" &&
  typeof value.title === "string" &&
  (value.status === "Pending" || value.status === "Filed" || value.status === "Failed") &&
  typeof value.attempts === "number" &&
  typeof value.receivedAt === "string" &&
  typeof value.clientName === "string" &&
  typeof value.nextAttemptAt === "string" &&
  (value.issueUrl === null || typeof value.issueUrl === "string") &&
  typeof value.slackPosted === "boolean" &&
  (value.lastFailure === null || isLastFailure(value.lastFailure));

const isInstallation: Guard<Installation> = (value): value is Installation =>
  isRecord(value) && typeof value.installationId === "number" && typeof value.account === "string";

const listOf =
  <T>(guard: Guard<T>): Guard<T[]> =>
  (value): value is T[] =>
    Array.isArray(value) && value.every(guard);

const isString: Guard<string> = (value): value is string => typeof value === "string";

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

export const isSecretMissing = (error: unknown): boolean =>
  error instanceof ApiError && error.body.reason === "SecretMissing";

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

export const listApps = (): Promise<App[]> => request("GET", "/api/apps", listOf(isApp));

export const getApp = (appId: string): Promise<AppDetail> =>
  request("GET", `/api/apps/${encodeURIComponent(appId)}`, isAppDetail);

export const createApp = (input: AppInput): Promise<App> =>
  request("POST", "/api/apps", isApp, input);

export const updateApp = (appId: string, input: AppInput): Promise<App> =>
  request("PUT", `/api/apps/${encodeURIComponent(appId)}`, isApp, input);

export const createClient = (appId: string, name: string): Promise<CreatedClient> =>
  request("POST", `/api/apps/${encodeURIComponent(appId)}/clients`, isCreatedClient, { name });

export const revokeClient = (clientId: string): Promise<Client> =>
  request("POST", `/api/clients/${encodeURIComponent(clientId)}/revoke`, isClient, {});

export const listReports = (appId: string): Promise<ReportRow[]> =>
  request("GET", `/api/apps/${encodeURIComponent(appId)}/reports`, listOf(isReportRow));

export const retryReport = (reportId: string): Promise<ReportRow> =>
  request("POST", `/api/reports/${encodeURIComponent(reportId)}/retry`, isReportRow, {});

export const listInstallations = (): Promise<Installation[]> =>
  request("GET", "/api/github/installations", listOf(isInstallation));

export const listRepos = (installationId: number): Promise<string[]> =>
  request("GET", `/api/github/installations/${installationId}/repos`, listOf(isString));
