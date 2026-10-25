import { useMutation, useQuery, useQueryClient } from "@tanstack/preact-query";
import { useState } from "preact/hooks";
import { Link } from "wouter-preact";
import {
  type App,
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  removeAppSlack,
  setAppSlack,
  type Workspace,
} from "./api";
import { Failure } from "./notices";
import { ExternalIcon, Loading, PageHeader, When } from "./ui";

const WORKSPACES = ["slack", "workspaces"];

const MANIFEST = {
  display_information: { name: "bugstack", description: "Bug reports filed as GitHub issues" },
  features: { bot_user: { display_name: "bugstack", always_online: false } },
  oauth_config: { scopes: { bot: ["chat:write"] } },
};

const CREATE_SLACK_APP = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(MANIFEST))}`;

const NewWorkspace = () => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [botToken, setBotToken] = useState("");
  const create = useMutation({
    mutationFn: () => createWorkspace({ name, botToken }),
    onSuccess: () => {
      setName("");
      setBotToken("");
      queryClient.invalidateQueries({ queryKey: WORKSPACES });
    },
  });
  return (
    <article class="form-card">
      <header>
        <h3>Add a workspace</h3>
        <p class="muted">bugstack checks the token with Slack before it stores it.</p>
      </header>
      <ol class="how-to">
        <li>
          <a href={CREATE_SLACK_APP} target="_blank" rel="noreferrer" class="with-icon">
            Create a Slack app
            <ExternalIcon />
          </a>{" "}
          from the prefilled manifest, then install it in your workspace.
        </li>
        <li>
          Paste its <code class="mono">xoxb-</code> bot token below.
        </li>
        <li>
          Run <code class="mono">/invite @bugstack</code> in each channel an app posts to.
        </li>
      </ol>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <div class="grid">
          <label>
            Name
            <input
              name="workspaceName"
              required
              maxLength={80}
              placeholder="Acme"
              value={name}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label>
            Bot token
            <input
              name="botToken"
              type="password"
              class="mono"
              autoComplete="off"
              required
              placeholder="xoxb-…"
              value={botToken}
              onInput={(event) => setBotToken(event.currentTarget.value)}
            />
          </label>
        </div>
        {create.isError && <Failure what="Adding the workspace" error={create.error} />}
        <button type="submit" aria-busy={create.isPending} disabled={create.isPending}>
          {create.isPending ? "Checking the token…" : "Add workspace"}
        </button>
      </form>
    </article>
  );
};

const DeleteWorkspace = ({ workspace }: { workspace: Workspace }) => {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteWorkspace(workspace.workspaceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORKSPACES }),
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
      {remove.isError && <Failure what={`Deleting ${workspace.name}`} error={remove.error} />}
    </>
  );
};

const WorkspaceCard = ({ workspace }: { workspace: Workspace }) => (
  <article class="card">
    <header>
      <h3>{workspace.name}</h3>
    </header>
    <ul class="meta">
      <li>
        <span class="meta-label">Workspace id</span>
        <span class="mono">{workspace.workspaceId}</span>
      </li>
      <li>
        <span class="meta-label">Added</span>
        <When iso={workspace.createdAt} />
      </li>
    </ul>
    <footer class="card-actions">
      <DeleteWorkspace workspace={workspace} />
    </footer>
  </article>
);

export const Workspaces = () => {
  const workspaces = useQuery({ queryKey: WORKSPACES, queryFn: listWorkspaces });
  return (
    <>
      <PageHeader
        title="Slack workspaces"
        description="Workspaces whose channels can get a link to each new issue."
      />
      {workspaces.isPending && <Loading what="Slack workspaces" />}
      {workspaces.isError && (
        <Failure what="Loading the Slack workspaces" error={workspaces.error} />
      )}
      {workspaces.isSuccess && workspaces.data.length === 0 && (
        <p class="empty-line">
          No Slack workspaces yet. Add one below, then pick a channel on an app.
        </p>
      )}
      {workspaces.isSuccess && workspaces.data.length > 0 && (
        <div class="card-grid">
          {workspaces.data.map((workspace) => (
            <WorkspaceCard key={workspace.workspaceId} workspace={workspace} />
          ))}
        </div>
      )}
      <NewWorkspace />
    </>
  );
};

const SlackForm = ({ app, workspaces }: { app: App; workspaces: Workspace[] }) => {
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState(app.slack?.workspaceId ?? "");
  const [channel, setChannel] = useState(app.slack?.channel ?? "");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["app", app.appId] });
  const save = useMutation({
    mutationFn: () => setAppSlack(app.appId, { workspaceId, channel }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => removeAppSlack(app.appId),
    onSuccess: () => {
      setWorkspaceId("");
      setChannel("");
      return refresh();
    },
  });
  const current = workspaces.find((workspace) => workspace.workspaceId === app.slack?.workspaceId);
  return (
    <>
      <p class="field-note">
        {app.slack === null
          ? "Reports from this app go to GitHub only."
          : `Reports post to ${app.slack.channel} in ${current?.name ?? app.slack.workspaceId}.`}
      </p>
      <form
        class="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label>
          Slack workspace
          <select
            name="workspaceId"
            required
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.currentTarget.value)}
          >
            <option value="">Choose a workspace</option>
            {workspaces.map((workspace) => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Channel
          <input
            name="channel"
            required
            maxLength={80}
            placeholder="bugs"
            value={channel}
            onInput={(event) => setChannel(event.currentTarget.value)}
          />
        </label>
        <div class="actions">
          <button type="submit" aria-busy={save.isPending} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save Slack channel"}
          </button>
          {app.slack !== null && (
            <button
              type="button"
              class="secondary outline"
              aria-busy={remove.isPending}
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Removing…" : "Remove Slack"}
            </button>
          )}
        </div>
      </form>
      {save.isError && <Failure what="Saving the Slack channel" error={save.error} />}
      {remove.isError && <Failure what="Removing the Slack channel" error={remove.error} />}
    </>
  );
};

export const AppSlack = ({ app }: { app: App }) => {
  const workspaces = useQuery({ queryKey: WORKSPACES, queryFn: listWorkspaces });
  if (workspaces.isPending) return <Loading what="Slack workspaces" />;
  if (workspaces.isError)
    return <Failure what="Loading the Slack workspaces" error={workspaces.error} />;
  if (workspaces.data.length === 0) {
    return (
      <p class="empty-line">
        No Slack workspaces yet. <Link href="/slack">Add one</Link> to post this app's reports to a
        channel.
      </p>
    );
  }
  return <SlackForm app={app} workspaces={workspaces.data} />;
};
