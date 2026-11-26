"use client";
import * as React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Button } from "./button";

interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
}

const ConfirmContext = React.createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

/** `const confirm = useConfirm(); if (await confirm({...})) ...` */
export function useConfirm() {
  return React.useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = React.useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog.Root open={!!state} onOpenChange={(o) => !o && close(false)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <AlertDialog.Content className="fixed left-1/2 top-[22vh] z-[60] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 rounded-2xl border bg-card p-6 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]">
            <AlertDialog.Title className="text-base font-semibold">{state?.title}</AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="mt-2 text-sm text-muted-foreground">{state?.description}</div>
            </AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="outline">{state?.cancelLabel ?? "Cancel"}</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button variant={state?.destructive ? "destructive" : "default"} onClick={() => close(true)}>
                  {state?.confirmLabel}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}
