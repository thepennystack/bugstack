import { useMutation, useQuery, useQueryClient } from "@tanstack/preact-query";
import { useState } from "preact/hooks";
import { Link, useLocation, useParams } from "wouter-preact";
import {
  type App,
  type AppInput,
  type CreatedClient,
  createApp,
  createClient,
  getApp,
  isSecretMissing,
  type LastFailure,
  listApps,
  listInstallations,
  listReports,
  listRepos,
  type ReportRow,
  retryReport,
  revokeClient,
  updateApp,
} from "./api";
import { Failure } from "./notices";
import { AppSlack } from "./slack";

const appKey = (appId: string) => ["app", appId];

export const AppList = () => {
  const apps = useQuery({ queryKey: ["apps"], queryFn: listApps });
  return (
    <section>
      <div class="heading">
        <h2>Apps</h2>
        <Link href="/apps/new" class="button">
          New app
        </Link>
      </div>
      {apps.isPending && <p>Loading apps…</p>}
      {apps.isError && <Failure what="Loading the apps" error={apps.error} />}
      {apps.isSuccess && apps.data.length === 0 && (
        <p>No apps yet. Create one to give a backend its client secret.</p>
      )}
      {apps.isSuccess && apps.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Repository</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {apps.data.map((app) => (
              <tr key={app.appId}>
                <td>
                  <Link href={`/apps/${app.appId}`}>{app.name}</Link>
                </td>
                <td>{app.githubRepo}</td>
                <td>{app.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};

const SecretsMissing = () => (
  <section class="notice" role="alert">
    <h3>GitHub App secrets are missing</h3>
    <p>
      The Worker cannot list GitHub installations. Set <code>GITHUB_APP_ID</code> and{" "}
      <code>GITHUB_APP_PRIVATE_KEY</code> with <code>npm run secret</code>, then reload. Until then,
      type the installation id and repository below.
    </p>
  </section>
);

type GitHubFieldsProps = {
  installationId: string;
  githubRepo: string;
  onInstallation: (value: string) => void;
  onRepo: (value: string) => void;
};

const ManualGitHubFields = ({
  installationId,
  githubRepo,
  onInstallation,
  onRepo,
}: GitHubFieldsProps) => (
  <>
    <label>
      Installation id
      <input
        name="installationId"
        inputMode="numeric"
        required
        value={installationId}
        onInput={(event) => onInstallation(event.currentTarget.value)}
      />
    </label>
    <label>
      Repository (owner/name)
      <input
        name="githubRepo"
        required
        value={githubRepo}
        onInput={(event) => onRepo(event.currentTarget.value)}
      />
    </label>
  </>
);

const RepoPicker = ({ installationId, githubRepo, onRepo }: GitHubFieldsProps) => {
  const id = Number(installationId);
  const repos = useQuery({
    queryKey: ["repos", id],
    queryFn: () => listRepos(id),
    enabled: installationId !== "",
  });
  if (installationId === "") return null;
  if (repos.isPending) return <p>Loading repositories…</p>;
  if (repos.isError)
    return <Failure what="Loading the installation's repositories" error={repos.error} />;
  if (repos.data.length === 0) {
    return (
      <p class="notice" role="alert">
        This installation grants no repositories. Add one in the GitHub App's installation settings.
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
    queryKey: ["installations"],
    queryFn: listInstallations,
    retry: false,
  });
  if (installations.isPending) return <p>Loading GitHub installations…</p>;
  if (installations.isError) {
    return (
      <>
        {isSecretMissing(installations.error) ? (
          <SecretsMissing />
        ) : (
          <Failure what="Loading the GitHub installations" error={installations.error} />
        )}
        <ManualGitHubFields {...props} />
      </>
    );
  }
  return (
    <>
      <label>
        GitHub installation
        <select
          name="installationId"
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
              {installation.account} ({installation.installationId})
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
    app === undefined ? "" : String(app.installationId),
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
    <form
      class="form"
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
      <button type="submit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save app"}
      </button>
    </form>
  );
};

export const NewApp = () => (
  <section>
    <h2>New app</h2>
    <AppForm />
  </section>
);

export const EditApp = () => {
  const { appId = "" } = useParams<{ appId: string }>();
  const detail = useQuery({ queryKey: appKey(appId), queryFn: () => getApp(appId) });
  if (detail.isPending) return <p>Loading the app…</p>;
  if (detail.isError) return <Failure what="Loading the app" error={detail.error} />;
  return (
    <section>
      <h2>Edit {detail.data.app.name}</h2>
      <AppForm app={detail.data.app} />
    </section>
  );
};

const SecretPanel = ({ client, onDone }: { client: CreatedClient; onDone: () => void }) => {
  const [copy, setCopy] = useState<"idle" | "copied" | Error>("idle");
  return (
    <section class="notice secret" role="status">
      <h3>Secret for client {client.name}</h3>
      <p>bugstack shows this secret once. Store it in the backend now.</p>
      <dl>
        <dt>Client id</dt>
        <dd>
          <code>{client.clientId}</code>
        </dd>
        <dt>Secret</dt>
        <dd>
          <code>{client.secret}</code>
        </dd>
      </dl>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard
            .writeText(client.secret)
            .then(() => setCopy("copied"))
            .catch((error: unknown) =>
              setCopy(error instanceof Error ? error : new Error(String(error))),
            );
        }}
      >
        {copy === "copied" ? "Copied" : "Copy secret"}
      </button>{" "}
      <button type="button" onClick={onDone}>
        Done
      </button>
      {copy instanceof Error && <Failure what="Copying the secret" error={copy} />}
    </section>
  );
};

const NewClient = ({ appId }: { appId: string }) => {
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
  return (
    <>
      {created !== null && <SecretPanel client={created} onDone={() => setCreated(null)} />}
      <form
        class="inline-form"
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
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <button type="submit" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create client"}
        </button>
      </form>
      {create.isError && <Failure what="Creating the client" error={create.error} />}
    </>
  );
};

const RevokeButton = ({ appId, clientId }: { appId: string; clientId: string }) => {
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: () => revokeClient(clientId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: appKey(appId) }),
  });
  return (
    <>
      <button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
        {revoke.isPending ? "Revoking…" : "Revoke"}
      </button>
      {revoke.isError && <Failure what="Revoking the client" error={revoke.error} />}
    </>
  );
};

const FailureCell = ({ failure }: { failure: LastFailure | null }) => {
  if (failure === null) return null;
  return (
    <>
      {failure.step} at {failure.failedAt}
      <br />
      <code>{failure.message}</code>
    </>
  );
};

const RetryButton = ({ appId, report }: { appId: string; report: ReportRow }) => {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => retryReport(report.reportId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...appKey(appId), "reports"] }),
  });
  return (
    <>
      <button type="button" disabled={retry.isPending} onClick={() => retry.mutate()}>
        {retry.isPending ? "Retrying…" : "Retry"}
      </button>
      {retry.isError && <Failure what="Retrying the report" error={retry.error} />}
    </>
  );
};

const Reports = ({ appId }: { appId: string }) => {
  const reports = useQuery({
    queryKey: [...appKey(appId), "reports"],
    queryFn: () => listReports(appId),
  });
  if (reports.isPending) return <p>Loading reports…</p>;
  if (reports.isError) return <Failure what="Loading the reports" error={reports.error} />;
  if (reports.data.length === 0) {
    return (
      <p>No reports yet. A client sends one with a signed POST to /v1/apps/{appId}/reports.</p>
    );
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Status</th>
          <th>Attempts</th>
          <th>Received</th>
          <th>Client</th>
          <th>Issue</th>
          <th>Slack</th>
          <th>Images</th>
          <th>Last failure</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {reports.data.map((report) => (
          <tr key={report.reportId}>
            <td>{report.title}</td>
            <td>{report.status}</td>
            <td>{report.attempts}</td>
            <td>{report.receivedAt}</td>
            <td>{report.clientName}</td>
            <td>
              {report.issueUrl !== null && (
                <a href={report.issueUrl} target="_blank" rel="noreferrer">
                  {report.issueUrl.replace("https://github.com/", "")}
                </a>
              )}
            </td>
            <td>{report.slackPosted ? "Posted" : ""}</td>
            <td>
              {report.images.map((imageId, index) => (
                <a key={imageId} href={`/v1/images/${imageId}`} target="_blank" rel="noreferrer">
                  {`Image ${index + 1} `}
                </a>
              ))}
            </td>
            <td>
              <FailureCell failure={report.lastFailure} />
            </td>
            <td>{report.status === "Failed" && <RetryButton appId={appId} report={report} />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export const AppPage = () => {
  const { appId = "" } = useParams<{ appId: string }>();
  const detail = useQuery({ queryKey: appKey(appId), queryFn: () => getApp(appId) });
  if (detail.isPending) return <p>Loading the app…</p>;
  if (detail.isError) return <Failure what="Loading the app" error={detail.error} />;
  const { app, clients } = detail.data;
  return (
    <section>
      <div class="heading">
        <h2>{app.name}</h2>
        <Link href={`/apps/${app.appId}/edit`} class="button">
          Edit
        </Link>
      </div>
      {app.description !== "" && <p>{app.description}</p>}
      <dl>
        <dt>App id</dt>
        <dd>
          <code>{app.appId}</code>
        </dd>
        <dt>Repository</dt>
        <dd>{app.githubRepo}</dd>
        <dt>Installation</dt>
        <dd>{app.installationId}</dd>
        <dt>Created</dt>
        <dd>{app.createdAt}</dd>
      </dl>
      <h3>Clients</h3>
      {clients.length === 0 ? (
        <p>No clients yet. Create one to sign reports.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Client id</th>
              <th>Status</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.clientId}>
                <td>{client.name}</td>
                <td>
                  <code>{client.clientId}</code>
                </td>
                <td>{client.status}</td>
                <td>{client.createdAt}</td>
                <td>
                  {client.status === "Active" && (
                    <RevokeButton appId={app.appId} clientId={client.clientId} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <NewClient appId={app.appId} />
      <h3>Slack</h3>
      <AppSlack app={app} />
      <h3>Reports</h3>
      <Reports appId={app.appId} />
    </section>
  );
};
