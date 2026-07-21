import { toast as sonner } from "svelte-sonner";

/** Thin app-facing toast API backed by shadcn Sonner. */
export const toast = {
  show(message: string) {
    sonner(message);
  },
  success(message: string) {
    sonner.success(message);
  },
  error(message: string) {
    sonner.error(message);
  },
};
