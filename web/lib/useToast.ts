"use client";

import { useCallback, useEffect, useState } from "react";

export interface ToastState {
    message: string;
    variant: "ok" | "error";
}

export function useToast(): {
    toast: ToastState | null;
    showToast: (message: string, variant?: "ok" | "error") => void;
} {
    const [toast, setToast] = useState<ToastState | null>(null);

    const showToast = useCallback((message: string, variant: "ok" | "error" = "ok") => {
        setToast({ message, variant });
    }, []);

    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(null), 3500);
        return () => clearTimeout(timer);
    }, [toast]);

    return { toast, showToast };
}
