import { useMutation, useQuery, useQueryClient } from "@tanstack/preact-query";
import { useState } from "preact/hooks";
import { Link, useSearch } from "wouter-preact";
import {
  type App,
  deleteWorkspace,
  listWorkspaces,
  removeAppSlack,
  setAppSlack,
  slackInstallUrl,
  type Workspace,
} from "./api";
import { Failure } from "./notices";
import { ConfirmDelete } from "./step";
import { Loading, PageHeader, When } from "./ui";

const WORKSPACES = ["slack", "workspaces"];

const InstallCard = () => (
  <article class="card">
    <header>
      <h3>Add bugstack to a workspace</h3>
    </header>
    <p>
      Slack asks you to pick a workspace and approve the bot. Then run{" "}
      <code class="mono">/invite @bugstack</code> in each channel an app posts to.
    </p>
    <footer class="card-actions">
      <a class="button" href={slackInstallUrl()}>
        Add to Slack
      </a>
    </footer>
  </article>
);

const WorkspaceCard = ({ workspace }: { workspace: Workspace }) => (
  <article class="card">
    <header>
      <h3>{workspace.teamName}</h3>
    </header>
    <ul class="meta">
      <li>
        <span class="meta-label">Added</span>
        <When iso={workspace.createdAt} />
      </li>
    </ul>
    <footer class="card-actions">
      <ConfirmDelete
        label="Remove"
        name={workspace.teamName}
        queryKey={WORKSPACES}
        remove={() => deleteWorkspace(workspace.workspaceId)}
      />
    </footer>
  </article>
);

export const Workspaces = () => {
  const workspaces = useQuery({ queryKey: WORKSPACES, queryFn: listWorkspaces });
  const installed = new URLSearchParams(useSearch()).get("installed");
  return (
    <>
      <PageHeader
        title="Slack"
        description="The Slack workspaces bugstack posts a link to each new issue in."
      />
      {installed !== null && (
        <article class="callout callout-success" role="status">
          <header>
            <h3>Installed in {installed}</h3>
          </header>
          <p>
            Run <code class="mono">/invite @bugstack</code> in each channel an app posts to, then
            pick the channel on the app.
          </p>
        </article>
      )}
      {workspaces.isError && (
        <Failure what="Loading the Slack workspaces" error={workspaces.error} />
      )}
      <div class="card-grid wide">
        <InstallCard />
        {workspaces.isPending && <Loading what="Slack workspaces" />}
        {workspaces.isSuccess &&
          workspaces.data.map((workspace) => (
            <WorkspaceCard key={workspace.workspaceId} workspace={workspace} />
          ))}
      </div>
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
          : `Reports post to ${app.slack.channel} in ${current?.teamName ?? app.slack.workspaceId}.`}
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
                {workspace.teamName}
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
        No Slack workspaces yet. <Link href="/slack">Add bugstack to Slack</Link> to post this app's
        reports to a channel.
      </p>
    );
  }
  return <SlackForm app={app} workspaces={workspaces.data} />;
};
