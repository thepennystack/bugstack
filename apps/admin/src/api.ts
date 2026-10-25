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

export type Counts = {
  clients: number;
  pending: number;
  filed: number;
  failed: number;
};

export type Health = {
  commit: string;
};

export type App = {
  appId: string;
  name: string;
  description: string;
  githubAppId: string;
  installationId: number;
  githubRepo: string;
  slack: Slack | null;
  counts: Counts;
  createdAt: string;
};

export type AppInput = {
  name: string;
  description: string;
  githubAppId: string;
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
  images: string[];
};

export type Workspace = {
  workspaceId: string;
  teamId: string;
  teamName: string;
  slackAppId: string;
  slackAppName: string;
  createdAt: string;
};

export type SlackApp = {
  slackAppId: string;
  name: string;
  clientId: string;
  createdAt: string;
};

export type SlackAppInput = {
  name: string;
  clientId: string;
  clientSecret: string;
  signingSecret: string;
};

export type Installation = {
  githubAppId: string;
  installationId: number;
  account: string;
  appSlug: string;
};

export type GitHubApp = {
  githubAppId: string;
  appIdNumber: number;
  slug: string;
  name: string;
  ownerLogin: string;
  htmlUrl: string;
  createdAt: string;
};

export type ManifestState = {
  state: string;
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

const isCounts: Guard<Counts> = (value): value is Counts =>
  isRecord(value) &&
  typeof value.clients === "number" &&
  typeof value.pending === "number" &&
  typeof value.filed === "number" &&
  typeof value.failed === "number";

const isHealth: Guard<Health> = (value): value is Health =>
  isRecord(value) && typeof value.commit === "string";

const isApp: Guard<App> = (value): value is App =>
  isRecord(value) &&
  typeof value.appId === "string" &&
  typeof value.name === "string" &&
  typeof value.description === "string" &&
  typeof value.githubAppId === "string" &&
  typeof value.installationId === "number" &&
  typeof value.githubRepo === "string" &&
  (value.slack === null || isSlack(value.slack)) &&
  isCounts(value.counts) &&
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
  (value.lastFailure === null || isLastFailure(value.lastFailure)) &&
  Array.isArray(value.images) &&
  value.images.every((image: unknown) => typeof image === "string");

const isInstallation: Guard<Installation> = (value): value is Installation =>
  isRecord(value) &&
  typeof value.githubAppId === "string" &&
  typeof value.installationId === "number" &&
  typeof value.account === "string" &&
  typeof value.appSlug === "string";

const isGitHubApp: Guard<GitHubApp> = (value): value is GitHubApp =>
  isRecord(value) &&
  typeof value.githubAppId === "string" &&
  typeof value.appIdNumber === "number" &&
  typeof value.slug === "string" &&
  typeof value.name === "string" &&
  typeof value.ownerLogin === "string" &&
  typeof value.htmlUrl === "string" &&
  typeof value.createdAt === "string" &&
  !("privateKey" in value) &&
  !("clientSecret" in value);

const isManifestState: Guard<ManifestState> = (value): value is ManifestState =>
  isRecord(value) && typeof value.state === "string";

const isWorkspace: Guard<Workspace> = (value): value is Workspace =>
  isRecord(value) &&
  typeof value.workspaceId === "string" &&
  typeof value.teamId === "string" &&
  typeof value.teamName === "string" &&
  typeof value.slackAppId === "string" &&
  typeof value.slackAppName === "string" &&
  typeof value.createdAt === "string" &&
  !("botToken" in value);

const isSlackApp: Guard<SlackApp> = (value): value is SlackApp =>
  isRecord(value) &&
  typeof value.slackAppId === "string" &&
  typeof value.name === "string" &&
  typeof value.clientId === "string" &&
  typeof value.createdAt === "string" &&
  !("clientSecret" in value) &&
  !("signingSecret" in value);

const isEmpty: Guard<undefined> = (value): value is undefined => value === undefined;

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

export const getHealth = (): Promise<Health> => request("GET", "/v1/health", isHealth);

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

export const deleteApp = (appId: string): Promise<undefined> =>
  request("DELETE", `/api/apps/${encodeURIComponent(appId)}`, isEmpty);

export const deleteClient = (clientId: string): Promise<undefined> =>
  request("DELETE", `/api/clients/${encodeURIComponent(clientId)}`, isEmpty);

export const listReports = (appId: string): Promise<ReportRow[]> =>
  request("GET", `/api/apps/${encodeURIComponent(appId)}/reports`, listOf(isReportRow));

export const retryReport = (reportId: string): Promise<ReportRow> =>
  request("POST", `/api/reports/${encodeURIComponent(reportId)}/retry`, isReportRow, {});

export const listInstallations = (): Promise<Installation[]> =>
  request("GET", "/api/github/installations", listOf(isInstallation));

export const listRepos = (githubAppId: string, installationId: number): Promise<string[]> =>
  request(
    "GET",
    `/api/github/installations/${installationId}/repos?githubAppId=${encodeURIComponent(githubAppId)}`,
    listOf(isString),
  );

export const listGitHubApps = (): Promise<GitHubApp[]> =>
  request("GET", "/api/github/apps", listOf(isGitHubApp));

export const createManifestState = (): Promise<ManifestState> =>
  request("POST", "/api/github/apps/state", isManifestState, {});

export const deleteGitHubApp = (githubAppId: string): Promise<undefined> =>
  request("DELETE", `/api/github/apps/${encodeURIComponent(githubAppId)}`, isEmpty);

export const listWorkspaces = (): Promise<Workspace[]> =>
  request("GET", "/api/slack/workspaces", listOf(isWorkspace));

export const listSlackApps = (): Promise<SlackApp[]> =>
  request("GET", "/api/slack/apps", listOf(isSlackApp));

export const createSlackApp = (input: SlackAppInput): Promise<SlackApp> =>
  request("POST", "/api/slack/apps", isSlackApp, input);

export const deleteSlackApp = (slackAppId: string): Promise<undefined> =>
  request("DELETE", `/api/slack/apps/${encodeURIComponent(slackAppId)}`, isEmpty);

export const slackInstallUrl = (slackAppId: string): string =>
  `/api/slack/apps/${encodeURIComponent(slackAppId)}/install`;

export const deleteWorkspace = (workspaceId: string): Promise<undefined> =>
  request("DELETE", `/api/slack/workspaces/${encodeURIComponent(workspaceId)}`, isEmpty);

export const setAppSlack = (appId: string, slack: Slack): Promise<undefined> =>
  request("PUT", `/api/apps/${encodeURIComponent(appId)}/slack`, isEmpty, slack);

export const removeAppSlack = (appId: string): Promise<undefined> =>
  request("DELETE", `/api/apps/${encodeURIComponent(appId)}/slack`, isEmpty);
