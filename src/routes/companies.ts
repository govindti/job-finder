import {
    getCompanies,
    getCompanyById,
    getCompanyStats,
    updateCompanyCrawlStatus,
    upsertCompany,
    type CompanyRow,
} from "../db/repo.js";
import { getAllSeedCompanies } from "../db/company_seed.js";
import { getAllMegaCompanies } from "../db/mega_companies.js";
import { runCompanyCrawl } from "../sources/collector.js";
import { makeCompanyId, utcNowIso } from "../utils/models.js";
import { companyInputSchema } from "../schemas/api.js";
import { detail, toInt, toStr, getQuery, readJson } from "./util.js";

// ── Companies API ───────────────────────────

export const companiesRoutes = {
    "/api/companies": {
        GET: async (req) => {
            const q = getQuery(req);
            const companies = await getCompanies({
                ats_platform: toStr(q.ats_platform),
                crawl_status: toStr(q.crawl_status),
                india_friendly: toStr(q.india_friendly),
                search: toStr(q.search),
                limit: toInt(q.limit, 200, 1, 500),
                offset: toInt(q.offset, 0, 0),
            });
            return Response.json({ companies, count: companies.length });
        },
        POST: async (req) => {
            const parsed = companyInputSchema.safeParse(await readJson(req));
            if (!parsed.success) {
                return detail(422, parsed.error.message);
            }
            const data: CompanyRow = {
                ...parsed.data,
                id: makeCompanyId(parsed.data.name),
                last_crawled: "",
                crawl_status: "active",
            };
            await upsertCompany(data);
            return Response.json({ ok: true, id: data.id });
        },
    },
    "/api/companies/stats": {
        GET: async (_req) => {
            return Response.json(await getCompanyStats());
        },
    },
    "/api/companies/:companyId": {
        PATCH: async (req) => {
            const companyId = req.params.companyId as string;
            const existing = await getCompanyById(companyId);
            if (!existing) {
                return Response.json({ error: "Not found" });
            }
            const parsed = companyInputSchema.safeParse(await readJson(req));
            if (!parsed.success) {
                return detail(422, parsed.error.message);
            }
            const data: CompanyRow = {
                ...parsed.data,
                id: companyId,
                last_crawled: existing.last_crawled ?? "",
                crawl_status: existing.crawl_status ?? "active",
            };
            await upsertCompany(data);
            return Response.json({ ok: true });
        },
        DELETE: async (req) => {
            await updateCompanyCrawlStatus(req.params.companyId as string, "paused", utcNowIso());
            return Response.json({ ok: true });
        },
    },
    "/api/companies/:companyId/activate": {
        POST: async (req) => {
            await updateCompanyCrawlStatus(req.params.companyId as string, "active");
            return Response.json({ ok: true });
        },
    },
    "/api/companies/seed": {
        POST: async (_req) => {
            const companies = getAllSeedCompanies();
            let added = 0;
            for (const c of companies) if (await upsertCompany(c)) added += 1;
            return Response.json({ seeded: companies.length, added });
        },
    },
    "/api/companies/mega-seed": {
        POST: async (_req) => {
            const companies = getAllMegaCompanies();
            let added = 0;
            for (const c of companies) if (await upsertCompany(c)) added += 1;
            return Response.json({ total_in_list: companies.length, added });
        },
    },
    "/api/companies/crawl": {
        POST: async (_req) => {
            return Response.json(await runCompanyCrawl());
        },
    },
    "/api/companies/:companyId/crawl": {
        POST: async (req) => {
            return Response.json(await runCompanyCrawl([req.params.companyId as string]));
        },
    },
    "/api/companies/detect-ats": {
        // detect-ats and bulk discover are not implemented.
        POST: (_req) => {
            return Response.json({ error: "not implemented" });
        },
    },
    "/api/companies/discover": {
        POST: (_req) => {
            return Response.json({ error: "not implemented" });
        },
    },
} satisfies Bun.Serve.Routes<undefined, string>;
