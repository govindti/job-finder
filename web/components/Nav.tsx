"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
    { href: "/", label: "Jobs" },
    { href: "/outreach", label: "Outreach" },
    { href: "/profile", label: "Profile" },
];

export function Nav() {
    const pathname = usePathname();
    return (
        <nav className="nav-tabs">
            {LINKS.map((link) => {
                const active =
                    link.href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(link.href);
                return (
                    <Link
                        key={link.href}
                        href={link.href}
                        className={`nav-tab${active ? " active" : ""}`}
                    >
                        {link.label}
                    </Link>
                );
            })}
        </nav>
    );
}
