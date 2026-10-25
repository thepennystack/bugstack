import { useMutation, useQuery, useQueryClient } from "@tanstack/preact-query";
import { useState } from "preact/hooks";
import {
  addMember,
  createOrg,
  listMembers,
  type Member,
  type OrgMembership,
  type Role,
  removeMember,
} from "./api";
import { Failure } from "./notices";
import { ConfirmDelete } from "./step";
import { Badge, Loading, PageHeader, PlusIcon, When } from "./ui";

const MEMBERS = ["members"];

export const orgHome = (orgId: string): string => `/orgs/${encodeURIComponent(orgId)}/apps`;

export const CreateOrg = ({ first }: { first: OrgMembership | undefined }) => {
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => createOrg(name.trim()),
    onSuccess: (org) => window.location.assign(orgHome(org.orgId)),
  });
  return (
    <>
      <PageHeader
        title="Create an organisation"
        description="An organisation holds your apps, GitHub installations and Slack workspaces. You become its Owner."
      />
      <article class="form-card">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label>
            Name
            <input
              name="name"
              required
              maxLength={80}
              placeholder="acme"
              autocomplete="organization"
              value={name}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <div class="actions">
            <button
              type="submit"
              aria-busy={create.isPending || create.isSuccess}
              disabled={create.isPending || create.isSuccess || name.trim() === ""}
            >
              {create.isPending ? "Creating…" : "Create organisation"}
            </button>
            {first !== undefined && (
              <a class="button secondary outline" href={orgHome(first.orgId)}>
                Back to {first.name}
              </a>
            )}
          </div>
        </form>
        {create.isError && <Failure what="Creating the organisation" error={create.error} />}
      </article>
    </>
  );
};

const InviteForm = ({ org }: { org: OrgMembership }) => {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("Member");
  const invite = useMutation({
    mutationFn: () => addMember({ email: email.trim(), role }),
    onSuccess: () => {
      setEmail("");
      return queryClient.invalidateQueries({ queryKey: MEMBERS });
    },
  });
  return (
    <section>
      <hgroup>
        <h2>Invite</h2>
        <p>
          No email is sent: the invitee signs in with that address at{" "}
          <span class="mono">{window.location.host}</span> and lands in {org.name}.
        </p>
      </hgroup>
      <form
        class="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          invite.mutate();
        }}
      >
        <label>
          Email
          <input
            type="email"
            name="email"
            required
            maxLength={254}
            placeholder="name@example.com"
            autocomplete="off"
            value={email}
            onInput={(event) => setEmail(event.currentTarget.value)}
          />
        </label>
        <label>
          Role
          <select
            name="role"
            value={role}
            onChange={(event) =>
              setRole(event.currentTarget.value === "Owner" ? "Owner" : "Member")
            }
          >
            <option value="Member">Member</option>
            <option value="Owner">Owner</option>
          </select>
        </label>
        <div class="actions">
          <button type="submit" aria-busy={invite.isPending} disabled={invite.isPending}>
            {invite.isPending ? "Inviting…" : "Invite"}
          </button>
        </div>
      </form>
      {invite.isSuccess && (
        <p class="field-note" role="status">
          Added {invite.data.identity} as {invite.data.role}.
        </p>
      )}
      {invite.isError && <Failure what="Inviting the member" error={invite.error} />}
    </section>
  );
};

const MemberAction = ({
  member,
  org,
  identity,
}: {
  member: Member;
  org: OrgMembership;
  identity: string;
}) => {
  if (member.identity === identity) {
    return (
      <ConfirmDelete
        label="Leave"
        pending="Leaving…"
        name={org.name}
        queryKey={MEMBERS}
        remove={() => removeMember(member.memberId)}
        onRemoved={() => window.location.assign("/")}
      />
    );
  }
  if (org.role !== "Owner") return null;
  return (
    <ConfirmDelete
      label="Remove"
      pending="Removing…"
      name={member.identity}
      queryKey={MEMBERS}
      remove={() => removeMember(member.memberId)}
    />
  );
};

const MemberTable = ({
  members,
  org,
  identity,
}: {
  members: Member[];
  org: OrgMembership;
  identity: string;
}) => (
  <div class="table-wrap">
    <table class="stack members">
      <thead>
        <tr>
          <th scope="col">Identity</th>
          <th scope="col">Role</th>
          <th scope="col">Joined</th>
          <th scope="col">
            <span class="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {members.map((member) => (
          <tr key={member.memberId}>
            <td class="stack-title member-identity">
              <span class="mono">{member.identity}</span>
              {member.identity === identity && <span class="muted"> (you)</span>}
            </td>
            <td data-label="Role">
              <Badge tone={member.role} />
            </td>
            <td data-label="Joined" class="nowrap">
              <When iso={member.createdAt} />
            </td>
            <td class="cell-action">
              <MemberAction member={member} org={org} identity={identity} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const Members = ({ org, identity }: { org: OrgMembership; identity: string }) => {
  const members = useQuery({ queryKey: MEMBERS, queryFn: listMembers });
  return (
    <>
      <PageHeader
        title="Members"
        description={`Everyone who can open ${org.name}. Owners invite and remove members.`}
      />
      {members.isPending && <Loading what="members" />}
      {members.isError && <Failure what="Loading the members" error={members.error} />}
      {members.isSuccess && <MemberTable members={members.data} org={org} identity={identity} />}
      {org.role === "Owner" && <InviteForm org={org} />}
      <section>
        <a class="button secondary outline with-icon" href="/orgs/new">
          <PlusIcon />
          Create another organisation
        </a>
      </section>
    </>
  );
};
