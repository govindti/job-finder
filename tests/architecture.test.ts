import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dir, "..");
const files = [...new Bun.Glob("src/**/*.ts").scanSync({ cwd: root })].map(file => file.replaceAll("\\", "/"));
const sources = new Map(files.map(file => [file, readFileSync(path.join(root, file), "utf8")]));
const owner = (file: string): string | undefined => file.match(/^src\/modules\/([^/]+)\//)?.[1];

function imports(file: string, text: string): Array<{ target: string; typeOnly: boolean }> {
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    return tree.statements.flatMap(node => {
        if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return [];
        const specifier = node.moduleSpecifier.text;
        if (!specifier.startsWith(".")) return [];
        const typeOnly = ts.isImportDeclaration(node) ? Boolean(node.importClause?.isTypeOnly) : node.isTypeOnly;
        return [{ target: path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)).replace(/\.js$/, ".ts"), typeOnly }];
    });
}

describe("domain architecture", () => {
    test("all eight domains have HTTP, validation, and service boundaries", () => {
        for (const domain of ["jobs", "companies", "profiles", "collection", "outreach", "email", "exports", "automation"]) {
            for (const layer of ["routes", "controller", "dto", "service"]) {
                expect(sources.has(`src/modules/${domain}/${domain}.${layer}.ts`)).toBe(true);
            }
        }
    });

    test("relative backend imports resolve and repositories stay domain-private", () => {
        for (const [file, text] of sources) {
            for (const { target } of imports(file, text)) {
                expect(sources.has(target)).toBe(true);
                if (target.endsWith(".repository.ts")) expect(owner(file)).toBe(owner(target));
            }
        }
    });

    test("routes only reference controllers and services contain no HTTP or SQL", () => {
        for (const [file, text] of sources) {
            if (file.endsWith(".routes.ts")) {
                for (const { target, typeOnly } of imports(file, text)) {
                    if (!typeOnly) expect(target.endsWith(".controller.ts")).toBe(true);
                }
                expect(text).not.toMatch(/=>|\basync\b|Response\./);
            }
            if (file.endsWith(".controller.ts")) {
                expect(text).not.toMatch(/\.repository|\.adapter|\/sources\/|\b(?:SELECT|INSERT INTO|DELETE FROM|UPDATE \w+ SET)\b/);
            }
            if (file.endsWith(".service.ts")) {
                expect(text).not.toMatch(/\b(?:Request|Response|BunRequest)\b|\b(?:SELECT|INSERT INTO|DELETE FROM|UPDATE \w+ SET)\b/);
            }
        }
    });

    test("runtime cross-domain dependencies are acyclic", () => {
        const edges = new Map<string, Set<string>>();
        for (const [file, text] of sources) {
            const from = owner(file);
            if (!from) continue;
            if (!edges.has(from)) edges.set(from, new Set());
            for (const { target, typeOnly } of imports(file, text)) {
                const to = owner(target);
                if (!typeOnly && to && to !== from) edges.get(from)!.add(to);
            }
        }
        const visited = new Set<string>();
        const visit = (domain: string, stack: Set<string>): void => {
            expect(stack.has(domain)).toBe(false);
            if (visited.has(domain)) return;
            const next = new Set(stack).add(domain);
            for (const dependency of edges.get(domain) ?? []) visit(dependency, next);
            visited.add(domain);
        };
        for (const domain of edges.keys()) visit(domain, new Set());
    });

    test("browser contract has no runtime imports and legacy files are removed", () => {
        expect(sources.get("src/common/errors/error-codes.ts")).not.toMatch(/\bimport\b|process\.|Bun\./);
        for (const oldPath of ["src/db/repo.ts", "src/routes/index.ts", "src/email/emailer.ts", "src/sources/collector.ts", "public/templates/dashboard.html", "public/templates/outreach.html", "public/templates/profile.html", "public/static/app.js", "public/static/style.css", "scripts/restructure-domains.ts"]) {
            expect(existsSync(path.join(root, oldPath))).toBe(false);
        }
        expect(sources.get("src/config/env.ts")).not.toContain("PUBLIC_DIR");
        expect(sources.get("src/server.ts")).not.toMatch(/Bun\.file|\/static\/|sendTemplate/);
    });
});
