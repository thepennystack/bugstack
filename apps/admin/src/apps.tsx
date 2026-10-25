import { useMutation, useQuery, useQueryClient } from "@tanstack/preact-query";
import { useState } from "preact/hooks";
import { Link, useLocation, useParams } from "wouter-preact";
import {
  type App,
  type AppInput,
  type Client,
  type CreatedClient,
  createApp,
  createClient,
  deleteApp,
  deleteClient,
  getApp,
  listApps,
  listInstallations,
  listReports,
  listRepos,
  type ReportRow,
  retryReport,
  revokeClient,
  updateApp,
} from "./api";
import { INSTALLATIONS, NoInstallation } from "./github";
import { Failure } from "./notices";
import { AppSlack } from "./slack";
import {
  Badge,
  CheckIcon,
  CopyIcon,
  ExternalIcon,
  Loading,
  PageHeader,
  PlusIcon,
  plural,
  When,
} from "./ui";

const appKey = (appId: string) => ["app", appId];

const NewAppButton = () => (
  <Link href="/apps/new" class="button with-icon">
    <PlusIcon />
    New app
  </Link>
);

const AppCard = ({ app }: { app: App }) => (
  <article class="card">
    <header>
      <h3>
        <Link href={`/apps/${app.appId}`}>{app.name}</Link>
      </h3>
    </header>
    <p class={app.description === "" ? "muted" : ""}>
      {app.description === "" ? "No description" : app.description}
    </p>
    <ul class="meta">
      <li>
        <span class="meta-label">Repository</span>
        <span class="mono">{app.githubRepo === "" ? "none" : app.githubRepo}</span>
      </li>
      <li>
        <span class="meta-label">Slack</span>
        <span class={app.slack === null ? "muted" : "mono"}>
          {app.slack === null ? "off" : `#${app.slack.channel.replace(/^#/, "")}`}
        </span>
      </li>
      <li>
        <span class="meta-label">Clients</span>
        <span>{plural(app.counts.clients, "active client", "active clients")}</span>
      </li>
    </ul>
    <footer class="badges">
      <Badge tone="Pending">{app.counts.pending} Pending</Badge>
      <Badge tone="Filed">{app.counts.filed} Filed</Badge>
      <Badge tone="Failed">{app.counts.failed} Failed</Badge>
    </footer>
  </article>
);

export const AppList = () => {
  const apps = useQuery({ queryKey: ["apps"], queryFn: listApps });
  return (
    <>
      <PageHeader
        title="Apps"
        description="Each app files the reports its backends sign into one GitHub repository."
        action={<NewAppButton />}
      />
      {apps.isPending && <Loading what="apps" />}
      {apps.isError && <Failure what="Loading the apps" error={apps.error} />}
      {apps.isSuccess && apps.data.length === 0 && (
        <article class="empty">
          <h3>No apps yet</h3>
          <p>
            Create an app for each backend that reports bugs. It gets a repository to file issues in
            and clients whose secrets sign the reports.
          </p>
          <NewAppButton />
        </article>
      )}
      {apps.isSuccess && apps.data.length > 0 && (
        <div class="card-grid">
          {apps.data.map((app) => (
            <AppCard key={app.appId} app={app} />
          ))}
        </div>
      )}
    </>
  );
};

type GitHubFieldsProps = {
  installationId: string;
  githubRepo: string;
  onInstallation: (installationId: string) => void;
  onRepo: (value: string) => void;
};

const RepoPicker = ({ installationId, githubRepo, onRepo }: GitHubFieldsProps) => {
  const id = Number(installationId);
  const chosen = installationId !== "";
  const repos = useQuery({
    queryKey: ["repos", id],
    queryFn: () => listRepos(id),
    enabled: chosen,
  });
  if (!chosen) return null;
  if (repos.isPending) return <Loading what="repositories" />;
  if (repos.isError)
    return <Failure what="Loading the installation's repositories" error={repos.error} />;
  if (repos.data.length === 0) {
    return (
      <p class="field-note">
        This installation grants no repositories. Add one in its GitHub installation settings, then
        reload this page.
      </p>
    );
  }
  return (
    <label>
      Repository
      <select
        name="githubRepo"
        required
        value={githubRepo}
        onChange={(event) => onRepo(event.currentTarget.value)}
      >
        <option value="">Choose a repository</option>
        {repos.data.map((repo) => (
          <option key={repo} value={repo}>
            {repo}
          </option>
        ))}
      </select>
    </label>
  );
};

const GitHubFields = (props: GitHubFieldsProps) => {
  const installations = useQuery({
    queryKey: INSTALLATIONS,
    queryFn: listInstallations,
    retry: false,
  });
  if (installations.isPending) return <Loading what="GitHub installations" />;
  if (installations.isError) {
    return <Failure what="Loading the GitHub installations" error={installations.error} />;
  }
  if (installations.data.length === 0) return <NoInstallation />;
  return (
    <>
      <label>
        GitHub installation
        <select
          name="installation"
          required
          value={props.installationId}
          onChange={(event) => {
            props.onInstallation(event.currentTarget.value);
            props.onRepo("");
          }}
        >
          <option value="">Choose an installation</option>
          {installations.data.map((installation) => (
            <option key={installation.installationId} value={String(installation.installationId)}>
              {installation.account}
            </option>
          ))}
        </select>
      </label>
      <RepoPicker {...props} />
    </>
  );
};

const AppForm = ({ app }: { app?: App }) => {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [name, setName] = useState(app?.name ?? "");
  const [description, setDescription] = useState(app?.description ?? "");
  const [installationId, setInstallationId] = useState(
    app === undefined || app.installationId === 0 ? "" : String(app.installationId),
  );
  const [githubRepo, setGithubRepo] = useState(app?.githubRepo ?? "");
  const save = useMutation({
    mutationFn: (input: AppInput) =>
      app === undefined ? createApp(input) : updateApp(app.appId, input),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["apps"] });
      queryClient.invalidateQueries({ queryKey: appKey(saved.appId) });
      navigate(`/apps/${saved.appId}`);
    },
  });
  return (
    <article class="form-card">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({
            name,
            description,
            installationId: installationId.trim() === "" ? Number.NaN : Number(installationId),
            githubRepo,
          });
        }}
      >
        <label>
          Name
          <input
            name="name"
            required
            maxLength={80}
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label>
          Description
          <textarea
            name="description"
            maxLength={500}
            rows={3}
            value={description}
            onInput={(event) => setDescription(event.currentTarget.value)}
          />
        </label>
        <GitHubFields
          installationId={installationId}
          githubRepo={githubRepo}
          onInstallation={setInstallationId}
          onRepo={setGithubRepo}
        />
        {save.isError && <Failure what="Saving the app" error={save.error} />}
        <div class="actions">
          <button type="submit" aria-busy={save.isPending} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save app"}
          </button>
          <Link
            href={app === undefined ? "/" : `/apps/${app.appId}`}
            class="button secondary outline"
          >
            Cancel
          </Link>
        </div>
      </form>
    </article>
  );
};

export const NewApp = () => (
  <>
    <PageHeader
      title="New app"
      description="Name the backend and pick the repository its reports become issues in."
    />
    <AppForm />
  </>
);

export const EditApp = () => {
  const { appId = "" } = useParams<{ appId: string }>();
  const detail = useQuery({ queryKey: appKey(appId), queryFn: () => getApp(appId) });
  if (detail.isPending) return <Loading what="the app" />;
  if (detail.isError) return <Failure what="Loading the app" error={detail.error} />;
  return (
    <>
      <PageHeader
        title={`Edit ${detail.data.app.name}`}
        description="Change the name, description or the repository reports file into."
      />
      <AppForm app={detail.data.app} />
    </>
  );
};

const CopyButton = ({ value, label }: { value: string; label: string }) => {
  const [copy, setCopy] = useState<"idle" | "copied" | Error>("idle");
  return (
    <>
      <button
        type="button"
        class="secondary outline small with-icon"
        onClick={() => {
          navigator.clipboard
            .writeText(value)
            .then(() => setCopy("copied"))
            .catch((error: unknown) =>
              setCopy(error instanceof Error ? error : new Error(String(error))),
            );
        }}
      >
        {copy === "copied" ? <CheckIcon /> : <CopyIcon />}
        {copy === "copied" ? "Copied" : label}
      </button>
      {copy instanceof Error && <Failure what="Copying to the clipboard" error={copy} />}
    </>
  );
};

const SecretPanel = ({
  appId,
  client,
  onDone,
}: {
  appId: string;
  client: CreatedClient;
  onDone: () => void;
}) => {
  const command = `BUGSTACK_CLIENT_SECRET='${client.secret}' npm run report -- ${window.location.origin} ${appId} ${client.clientId} "Test report from ${client.name}"`;
  const headers = [
    `X-Bugstack-Client: ${client.clientId}`,
    "X-Bugstack-Timestamp: <Unix seconds, within 300 s>",
    'X-Bugstack-Signature: <hex HMAC-SHA256 of "{timestamp}.{raw body}", keyed with the secret>',
  ].join("\n");
  return (
    <article class="secret-panel" role="status">
      <header>
        <h3>Secret for {client.name}</h3>
        <p class="shown-once">
          This secret is shown once. Store it in the backend now; bugstack cannot show it again.
        </p>
      </header>
      <div class="copy-row">
        <code class="mono secret">{client.secret}</code>
        <CopyButton value={client.secret} label="Copy" />
      </div>
      <h4>Sign each report with these headers</h4>
      <pre class="mono">{headers}</pre>
      <h4>Send a test report</h4>
      <div class="copy-row">
        <pre class="mono">{command}</pre>
        <CopyButton value={command} label="Copy" />
      </div>
      <footer>
        <button type="button" onClick={onDone}>
          I stored the secret
        </button>
      </footer>
    </article>
  );
};

const NewClient = ({ appId, onCancel }: { appId: string; onCancel: () => void }) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedClient | null>(null);
  const create = useMutation({
    mutationFn: () => createClient(appId, name),
    onSuccess: (client) => {
      setCreated(client);
      setName("");
      queryClient.invalidateQueries({ queryKey: appKey(appId) });
    },
  });
  if (created !== null) {
    return <SecretPanel appId={appId} client={created} onDone={onCancel} />;
  }
  return (
    <article class="form-card">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label>
          New client name
          <input
            name="clientName"
            required
            maxLength={80}
            placeholder="production"
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
          />
          <small>Name the backend or environment that will sign reports with it.</small>
        </label>
        {create.isError && <Failure what="Creating the client" error={create.error} />}
        <div class="actions">
          <button type="submit" aria-busy={create.isPending} disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create client"}
          </button>
          <button type="button" class="secondary outline" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </article>
  );
};

const RevokeButton = ({ appId, clientId }: { appId: string; clientId: string }) => {
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: () => revokeClient(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appKey(appId) });
      queryClient.invalidateQueries({ queryKey: ["apps"] });
    },
  });
  return (
    <>
      <button
        type="button"
        class="secondary outline small"
        aria-busy={revoke.isPending}
        disabled={revoke.isPending}
        onClick={() => revoke.mutate()}
      >
        {revoke.isPending ? "Revoking…" : "Revoke"}
      </button>
      {revoke.isError && <Failure what="Revoking the client" error={revoke.error} />}
    </>
  );
};

const DeleteClientButton = ({ appId, client }: { appId: string; client: Client }) => {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteClient(client.clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appKey(appId) });
      queryClient.invalidateQueries({ queryKey: [...appKey(appId), "reports"] });
    },
  });
  return (
    <>
      <button
        type="button"
        class="secondary outline small"
        aria-busy={remove.isPending}
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        {remove.isPending ? "Deleting…" : "Delete"}
      </button>
      {remove.isError && <Failure what={`Deleting ${client.name}`} error={remove.error} />}
    </>
  );
};

const Clients = ({ appId, clients }: { appId: string; clients: Client[] }) => {
  const [adding, setAdding] = useState(false);
  return (
    <section>
      <div class="section-header">
        <hgroup>
          <h2>Clients</h2>
          <p>Each client holds a secret a backend signs its reports with.</p>
        </hgroup>
        {!adding && (
          <button type="button" class="with-icon" onClick={() => setAdding(true)}>
            <PlusIcon />
            New client
          </button>
        )}
      </div>
      {adding && <NewClient appId={appId} onCancel={() => setAdding(false)} />}
      {clients.length === 0 ? (
        <p class="empty-line">No clients yet. Create one to give a backend its signing secret.</p>
      ) : (
        <div class="table-wrap">
          <table class="stack">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.clientId}>
                  <td class="stack-title">
                    <div>{client.name}</div>
                    <code class="mono id">{client.clientId}</code>
                  </td>
                  <td data-label="Status">
                    <Badge tone={client.status} />
                  </td>
                  <td data-label="Created">
                    <When iso={client.createdAt} />
                  </td>
                  <td class="cell-action">
                    {client.status === "Active" && (
                      <RevokeButton appId={appId} clientId={client.clientId} />
                    )}
                    {client.status === "Revoked" && (
                      <DeleteClientButton appId={appId} client={client} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

const RetryButton = ({ appId, report }: { appId: string; report: ReportRow }) => {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => retryReport(report.reportId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...appKey(appId), "reports"] });
      queryClient.invalidateQueries({ queryKey: ["apps"] });
    },
  });
  return (
    <>
      <button
        type="button"
        class="small"
        aria-busy={retry.isPending}
        disabled={retry.isPending}
        onClick={() => retry.mutate()}
      >
        {retry.isPending ? "Retrying…" : "Retry"}
      </button>
      {retry.isError && <Failure what="Retrying the report" error={retry.error} />}
    </>
  );
};

const REPORT_COLUMNS = 8;

const ReportRows = ({ appId, report }: { appId: string; report: ReportRow }) => (
  <>
    <tr class={report.lastFailure === null ? "" : "has-detail"}>
      <td class="nowrap" data-label="Received">
        <When iso={report.receivedAt} />
      </td>
      <td class="title-cell stack-title">{report.title}</td>
      <td data-label="Client">{report.clientName}</td>
      <td class="nowrap" data-label="Status">
        <Badge tone={report.status} />
        <small class="muted attempts">{plural(report.attempts, "attempt", "attempts")}</small>
      </td>
      <td class="nowrap" data-label="Issue">
        {report.issueUrl === null ? (
          <span class="muted">none</span>
        ) : (
          <a href={report.issueUrl} target="_blank" rel="noreferrer" class="with-icon">
            {report.issueUrl
              .replace(/^https:\/\/github\.com\/[^/]+\//, "")
              .replace("/issues/", "#")}
            <ExternalIcon />
          </a>
        )}
      </td>
      <td data-label="Slack">
        {report.slackPosted ? (
          <span class="posted" title="Posted to Slack">
            <CheckIcon />
            <span class="visually-hidden">Posted</span>
          </span>
        ) : (
          <span class="muted">no</span>
        )}
      </td>
      <td class="nowrap" data-label="Images">
        {report.images.length === 0 && <span class="muted">none</span>}
        {report.images.map((imageId, index) => (
          <a
            key={imageId}
            class="image-link"
            href={`/v1/images/${imageId}`}
            target="_blank"
            rel="noreferrer"
          >
            {index + 1}
          </a>
        ))}
      </td>
      <td class="cell-action">
        {report.status === "Failed" && <RetryButton appId={appId} report={report} />}
      </td>
    </tr>
    {report.lastFailure !== null && (
      <tr class="detail-row">
        <td colSpan={REPORT_COLUMNS} class="detail-cell">
          <details>
            <summary>
              Last failure: {report.lastFailure.step}, <When iso={report.lastFailure.failedAt} />
            </summary>
            <pre class="mono">{report.lastFailure.message}</pre>
          </details>
        </td>
      </tr>
    )}
  </>
);

const Reports = ({ appId }: { appId: string }) => {
  const reports = useQuery({
    queryKey: [...appKey(appId), "reports"],
    queryFn: () => listReports(appId),
  });
  return (
    <section>
      <hgroup>
        <h2>Reports</h2>
        <p>The newest 100 reports, with where each one got filed.</p>
      </hgroup>
      {reports.isPending && <Loading what="reports" />}
      {reports.isError && <Failure what="Loading the reports" error={reports.error} />}
      {reports.isSuccess && reports.data.length === 0 && (
        <p class="empty-line">
          No reports yet. A client sends one with a signed POST to{" "}
          <code class="mono">/v1/apps/{appId}/reports</code>.
        </p>
      )}
      {reports.isSuccess && reports.data.length > 0 && (
        <div class="table-wrap">
          <table class="reports stack">
            <thead>
              <tr>
                <th>Received</th>
                <th>Title</th>
                <th>Client</th>
                <th>Status</th>
                <th>Issue</th>
                <th>Slack</th>
                <th>Images</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reports.data.map((report) => (
                <ReportRows key={report.reportId} appId={appId} report={report} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

const AppFacts = ({ app }: { app: App }) => (
  <dl class="facts">
    <div>
      <dt>App id</dt>
      <dd>
        <code class="mono id">{app.appId}</code>
      </dd>
    </div>
    <div>
      <dt>Repository</dt>
      <dd>
        {app.githubRepo === "" ? (
          <span class="muted">none</span>
        ) : (
          <a
            class="mono"
            href={`https://github.com/${app.githubRepo}`}
            target="_blank"
            rel="noreferrer"
          >
            {app.githubRepo}
          </a>
        )}
      </dd>
    </div>
    <div>
      <dt>Installation</dt>
      <dd>
        {app.installationId === 0 ? (
          <span class="muted">No installation picked</span>
        ) : (
          <span class="mono">{app.installationId}</span>
        )}
      </dd>
    </div>
    <div>
      <dt>Slack</dt>
      <dd>
        {app.slack === null ? (
          <span class="muted">off</span>
        ) : (
          <span class="mono">#{app.slack.channel.replace(/^#/, "")}</span>
        )}
      </dd>
    </div>
    <div>
      <dt>Created</dt>
      <dd>
        <When iso={app.createdAt} />
      </dd>
    </div>
  </dl>
);

const DangerZone = ({ app }: { app: App }) => {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const remove = useMutation({
    mutationFn: () => deleteApp(app.appId),
    onSuccess: () => {
      navigate("/");
      queryClient.removeQueries({ queryKey: appKey(app.appId) });
      queryClient.invalidateQueries({ queryKey: ["apps"] });
    },
  });
  const cancel = () => {
    setConfirming(false);
    setTyped("");
  };
  return (
    <section class="danger-zone">
      <hgroup>
        <h2>Danger zone</h2>
        <p>
          Deleting the app removes its clients, reports and screenshots. Issues already filed on
          GitHub stay.
        </p>
      </hgroup>
      {!confirming && (
        <div class="actions">
          <button type="button" class="danger" onClick={() => setConfirming(true)}>
            Delete app
          </button>
        </div>
      )}
      {confirming && (
        <article class="form-card">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (typed === app.name) remove.mutate();
            }}
          >
            <label>
              Type <code class="mono">{app.name}</code> to confirm
              <input
                name="confirmName"
                autoComplete="off"
                required
                value={typed}
                onInput={(event) => setTyped(event.currentTarget.value)}
              />
            </label>
            {remove.isError && <Failure what={`Deleting ${app.name}`} error={remove.error} />}
            <div class="actions">
              <button
                type="submit"
                class="danger"
                aria-busy={remove.isPending}
                disabled={typed !== app.name || remove.isPending}
              >
                {remove.isPending ? "Deleting…" : "Delete app"}
              </button>
              <button type="button" class="secondary outline" onClick={cancel}>
                Cancel
              </button>
            </div>
          </form>
        </article>
      )}
    </section>
  );
};

export const AppPage = () => {
  const { appId = "" } = useParams<{ appId: string }>();
  const detail = useQuery({ queryKey: appKey(appId), queryFn: () => getApp(appId) });
  if (detail.isPending) return <Loading what="the app" />;
  if (detail.isError) return <Failure what="Loading the app" error={detail.error} />;
  const { app, clients } = detail.data;
  return (
    <>
      <nav aria-label="breadcrumb">
        <ul>
          <li>
            <Link href="/">Apps</Link>
          </li>
          <li>{app.name}</li>
        </ul>
      </nav>
      <PageHeader
        title={app.name}
        description={app.description === "" ? "No description" : app.description}
        action={
          <Link href={`/apps/${app.appId}/edit`} class="button secondary outline">
            Edit
          </Link>
        }
      />
      <AppFacts app={app} />
      <Clients appId={app.appId} clients={clients} />
      <section>
        <hgroup>
          <h2>Slack</h2>
          <p>Post a link to each new issue in one channel.</p>
        </hgroup>
        <AppSlack app={app} />
      </section>
      <Reports appId={app.appId} />
      <DangerZone app={app} />
    </>
  );
};
