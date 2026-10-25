import { useMutation, useQueryClient } from "@tanstack/preact-query";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Failure } from "./notices";

export const Step = ({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    element.showModal();
  }, []);
  return (
    <dialog ref={dialog} class="step" aria-labelledby="step-title" onClose={onClose}>
      <article>
        <header>
          <button type="button" aria-label="Close" class="close" onClick={onClose} />
          <h2 id="step-title">{title}</h2>
          <p class="muted">{description}</p>
        </header>
        {children}
      </article>
    </dialog>
  );
};

export const ConfirmDelete = ({
  name,
  queryKey,
  remove: removeFn,
  label = "Delete",
}: {
  name: string;
  queryKey: string[];
  remove: () => Promise<undefined>;
  label?: string;
}) => {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: removeFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
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
          {remove.isPending ? "Deleting…" : `Yes, ${label.toLowerCase()}`}
        </button>
        <button type="button" class="secondary outline" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
      {remove.isError && <Failure what={`Deleting ${name}`} error={remove.error} />}
    </div>
  );
};
