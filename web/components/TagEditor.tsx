"use client";

import { useState } from "react";

export function TagEditor({
    values,
    onChange,
    placeholder = "type + Enter",
}: {
    values: string[];
    onChange: (values: string[]) => void;
    placeholder?: string;
}) {
    const [draft, setDraft] = useState("");

    function commit(): void {
        const value = draft.trim();
        if (!value) return;
        if (!values.includes(value)) onChange([...values, value]);
        setDraft("");
    }

    return (
        <div className="tag-editor">
            {values.map((value) => (
                <span className="chip" key={value}>
                    {value}
                    <button
                        type="button"
                        aria-label={`Remove ${value}`}
                        onClick={() => onChange(values.filter((item) => item !== value))}
                    >
                        ×
                    </button>
                </span>
            ))}
            <input
                className="chip-input"
                value={draft}
                placeholder={placeholder}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault();
                        commit();
                    } else if (event.key === "Backspace" && !draft && values.length) {
                        onChange(values.slice(0, -1));
                    }
                }}
                onBlur={commit}
            />
        </div>
    );
}
