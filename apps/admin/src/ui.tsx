import type { ComponentChildren } from "preact";

export const REPO = "https://github.com/thepennystack/bugstack";

export const BrandMark = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" class="brand-mark">
    <rect width="32" height="32" rx="8" fill="currentColor" />
    <path
      d="M8 11.5 16 7l8 4.5-8 4.5zM8 16.25l8 4.5 8-4.5M8 20.75l8 4.5 8-4.5"
      fill="none"
      stroke="var(--brand-ink)"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

const Icon = ({ children }: { children: ComponentChildren }) => (
  <svg
    class="icon"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CopyIcon = () => (
  <Icon>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon>
    <path d="m5 12 5 5 9-10" />
  </Icon>
);

export const ExternalIcon = () => (
  <Icon>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Icon>
);

export const PageHeader = ({
  title,
  description,
  action,
}: {
  title: ComponentChildren;
  description: ComponentChildren;
  action?: ComponentChildren;
}) => (
  <div class="page-header">
    <hgroup>
      <h1>{title}</h1>
      <p>{description}</p>
    </hgroup>
    {action}
  </div>
);

export const Loading = ({ what }: { what: string }) => (
  <p class="loading" aria-busy="true">
    Loading {what}…
  </p>
);

type Tone = "Pending" | "Filed" | "Failed" | "Active" | "Revoked" | "Owner" | "Member";

export const Badge = ({ tone, children }: { tone: Tone; children?: ComponentChildren }) => (
  <span class={`badge badge-${tone.toLowerCase()}`}>{children ?? tone}</span>
);

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export const When = ({ iso }: { iso: string }) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return <span>{iso}</span>;
  return (
    <time dateTime={iso} title={iso}>
      {dateFormat.format(date)}
    </time>
  );
};

export const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;
