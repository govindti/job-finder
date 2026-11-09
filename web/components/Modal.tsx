"use client";

import type { ReactNode } from "react";

export function Modal({
    open,
    onClose,
    width,
    children,
}: {
    open: boolean;
    onClose: () => void;
    width?: number;
    children: ReactNode;
}) {
    if (!open) return null;
    return (
        <div
            className="modal-overlay active"
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="modal" style={width ? { width } : undefined}>
                {children}
            </div>
        </div>
    );
}
