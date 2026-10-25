import { useMutation, useQueryClient } from "@tanstack/preact-query";
import { useState } from "preact/hooks";
import { Failure } from "./notices";

export const ConfirmDelete = ({
  name,
  queryKey,
  remove: removeFn,
  label = "Delete",
  pending = "Deleting…",
  onRemoved,
}: {
  name: string;
  queryKey: string[];
  remove: () => Promise<undefined>;
  label?: string;
  pending?: string;
  onRemoved?: () => void;
}) => {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: removeFn,
    onSuccess: () => {
      onRemoved?.();
      return queryClient.invalidateQueries({ queryKey });
    },
  });
  if (!confirming) {
    return (
      <button type="button" class="secondary outline" onClick={() => setConfirming(true)}>
        {label}
      </button>
    );
  }
  return (
    <div class="confirm">
      <p>
        {label} <strong>{name}</strong>?
      </p>
      <div class="actions">
        <button
          type="button"
          class="danger"
          aria-busy={remove.isPending}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          {remove.isPending ? pending : `Yes, ${label.toLowerCase()}`}
        </button>
        <button type="button" class="secondary outline" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
      {remove.isError && <Failure what={`${label} ${name}`} error={remove.error} />}
    </div>
  );
};
