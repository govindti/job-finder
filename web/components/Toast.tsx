"use client";

import type { ToastState } from "@/lib/useToast";

export function Toast({ toast }: { toast: ToastState | null }) {
    if (!toast) return null;
    return (
        <div
            className="toast"
            style={
                toast.variant === "error"
                    ? { borderColor: "var(--red)", color: "var(--red)" }
                    : undefined
            }
        >
            {toast.message}
        </div>
    );
}
