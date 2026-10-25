export type ErrorBody = {
  reason: string;
  message: string;
};

export type Role = "Owner" | "Member";

export type OrgMembership = {
  orgId: string;
  name: string;
  role: Role;
};

export type Me = {
  identity: string;
  orgs: OrgMembership[];
};

export type Member = {
  memberId: string;
  identity: string;
  role: Role;
  createdAt: string;
};

export type MemberInput = {
  email: string;
  role: Role;
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
  installationId: number;
  githubRepo: string;
  slack: Slack | null;
  counts: Counts;
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
  images: string[];
};

export type Workspace = {
  workspaceId: string;
  teamId: string;
  teamName: string;
  createdAt: string;
};

export type Installation = {
  installationId: number;
  account: string;
};

export type InstallUrl = {
  url: string;
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

const isRole = (value: unknown): value is Role => value === "Owner" || value === "Member";

const isOrgMembership: Guard<OrgMembership> = (value): value is OrgMembership =>
  isRecord(value) &&
  typeof value.orgId === "string" &&
  typeof value.name === "string" &&
  isRole(value.role);

const isMember: Guard<Member> = (value): value is Member =>
  isRecord(value) &&
  typeof value.memberId === "string" &&
  typeof value.identity === "string" &&
  isRole(value.role) &&
  typeof value.createdAt === "string";

const isMe: Guard<Me> = (value): value is Me =>
  isRecord(value) &&
  typeof value.identity === "string" &&
  Array.isArray(value.orgs) &&
  value.orgs.every(isOrgMembership);

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
  isRecord(value) && typeof value.installationId === "number" && typeof value.account === "string";

const isInstallUrl: Guard<InstallUrl> = (value): value is InstallUrl =>
  isRecord(value) && typeof value.url === "string";

const isWorkspace: Guard<Workspace> = (value): value is Workspace =>
  isRecord(value) &&
  typeof value.workspaceId === "string" &&
  typeof value.teamId === "string" &&
  typeof value.teamName === "string" &&
  typeof value.createdAt === "string" &&
  !("botToken" in value);

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

let me: Promise<Me> | undefined;
let orgBase: string | undefined;

export const getMe = (): Promise<Me> => {
  me ??= request("GET", "/api/me", isMe).catch((error: unknown) => {
    me = undefined;
    throw error;
  });
  return me;
};

export const createOrg = (name: string): Promise<OrgMembership> =>
  request("POST", "/api/orgs", isOrgMembership, { name });

export const selectOrg = (orgId: string): void => {
  orgBase = `/api/orgs/${encodeURIComponent(orgId)}`;
};

const scopedPath = (path: string): string => {
  if (orgBase === undefined) throw new Error("no organisation is selected yet");
  return `${orgBase}${path}`;
};

const scoped = <T>(method: string, path: string, guard: Guard<T>, body?: unknown): Promise<T> =>
  request(method, scopedPath(path), guard, body);

export const listApps = (): Promise<App[]> => scoped("GET", "/apps", listOf(isApp));

export const getApp = (appId: string): Promise<AppDetail> =>
  scoped("GET", `/apps/${encodeURIComponent(appId)}`, isAppDetail);

export const createApp = (input: AppInput): Promise<App> => scoped("POST", "/apps", isApp, input);

export const updateApp = (appId: string, input: AppInput): Promise<App> =>
  scoped("PUT", `/apps/${encodeURIComponent(appId)}`, isApp, input);

export const createClient = (appId: string, name: string): Promise<CreatedClient> =>
  scoped("POST", `/apps/${encodeURIComponent(appId)}/clients`, isCreatedClient, { name });

export const revokeClient = (clientId: string): Promise<Client> =>
  scoped("POST", `/clients/${encodeURIComponent(clientId)}/revoke`, isClient, {});

export const deleteApp = (appId: string): Promise<undefined> =>
  scoped("DELETE", `/apps/${encodeURIComponent(appId)}`, isEmpty);

export const deleteClient = (clientId: string): Promise<undefined> =>
  scoped("DELETE", `/clients/${encodeURIComponent(clientId)}`, isEmpty);

export const listReports = (appId: string): Promise<ReportRow[]> =>
  scoped("GET", `/apps/${encodeURIComponent(appId)}/reports`, listOf(isReportRow));

export const retryReport = (reportId: string): Promise<ReportRow> =>
  scoped("POST", `/reports/${encodeURIComponent(reportId)}/retry`, isReportRow, {});

export const listInstallations = (): Promise<Installation[]> =>
  scoped("GET", "/github/installations", listOf(isInstallation));

export const listRepos = (installationId: number): Promise<string[]> =>
  scoped("GET", `/github/installations/${installationId}/repos`, listOf(isString));

export const startGitHubInstall = (): Promise<InstallUrl> =>
  scoped("POST", "/github/install", isInstallUrl, {});

export const listWorkspaces = (): Promise<Workspace[]> =>
  scoped("GET", "/slack/workspaces", listOf(isWorkspace));

export const slackInstallUrl = (): string => scopedPath("/slack/install");

export const deleteWorkspace = (workspaceId: string): Promise<undefined> =>
  scoped("DELETE", `/slack/workspaces/${encodeURIComponent(workspaceId)}`, isEmpty);

export const setAppSlack = (appId: string, slack: Slack): Promise<undefined> =>
  scoped("PUT", `/apps/${encodeURIComponent(appId)}/slack`, isEmpty, slack);

export const removeAppSlack = (appId: string): Promise<undefined> =>
  scoped("DELETE", `/apps/${encodeURIComponent(appId)}/slack`, isEmpty);

export const listMembers = (): Promise<Member[]> => scoped("GET", "/members", listOf(isMember));

export const addMember = (input: MemberInput): Promise<Member> =>
  scoped("POST", "/members", isMember, input);

export const removeMember = (memberId: string): Promise<undefined> =>
  scoped("DELETE", `/members/${encodeURIComponent(memberId)}`, isEmpty);
