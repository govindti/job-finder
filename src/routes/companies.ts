import { Router } from "express";
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
import { asyncHandler, detail, toInt, toStr } from "./util.js";

// ── Companies API ───────────────────────────
export const companiesRouter = Router();

companiesRouter.get(
    "/companies",
    asyncHandler(async (req, res) => {
        const q = req.query;
        const companies = await getCompanies({
            ats_platform: toStr(q.ats_platform),
            crawl_status: toStr(q.crawl_status),
            india_friendly: toStr(q.india_friendly),
            search: toStr(q.search),
            limit: toInt(q.limit, 200, 1, 500),
            offset: toInt(q.offset, 0, 0),
        });
        res.json({ companies, count: companies.length });
    }),
);

companiesRouter.get(
    "/companies/stats",
    asyncHandler(async (_req, res) => {
        res.json(await getCompanyStats());
    }),
);

companiesRouter.post(
    "/companies",
    asyncHandler(async (req, res) => {
        const parsed = companyInputSchema.safeParse(req.body);
        if (!parsed.success) {
            detail(res, 422, parsed.error.message);
            return;
        }
        const data: CompanyRow = {
            ...parsed.data,
            id: makeCompanyId(parsed.data.name),
            last_crawled: "",
            crawl_status: "active",
        };
        await upsertCompany(data);
        res.json({ ok: true, id: data.id });
    }),
);

companiesRouter.patch(
    "/companies/:companyId",
    asyncHandler(async (req, res) => {
        const companyId = req.params.companyId as string;
        const existing = await getCompanyById(companyId);
        if (!existing) {
            res.json({ error: "Not found" });
            return;
        }
        const parsed = companyInputSchema.safeParse(req.body);
        if (!parsed.success) {
            detail(res, 422, parsed.error.message);
            return;
        }
        const data: CompanyRow = {
            ...parsed.data,
            id: companyId,
            last_crawled: existing.last_crawled ?? "",
            crawl_status: existing.crawl_status ?? "active",
        };
        await upsertCompany(data);
        res.json({ ok: true });
    }),
);

companiesRouter.delete(
    "/companies/:companyId",
    asyncHandler(async (req, res) => {
        await updateCompanyCrawlStatus(req.params.companyId as string, "paused", utcNowIso());
        res.json({ ok: true });
    }),
);

companiesRouter.post(
    "/companies/:companyId/activate",
    asyncHandler(async (req, res) => {
        await updateCompanyCrawlStatus(req.params.companyId as string, "active");
        res.json({ ok: true });
    }),
);

companiesRouter.post(
    "/companies/seed",
    asyncHandler(async (_req, res) => {
        const companies = getAllSeedCompanies();
        let added = 0;
        for (const c of companies) if (await upsertCompany(c)) added += 1;
        res.json({ seeded: companies.length, added });
    }),
);

companiesRouter.post(
    "/companies/mega-seed",
    asyncHandler(async (_req, res) => {
        const companies = getAllMegaCompanies();
        let added = 0;
        for (const c of companies) if (await upsertCompany(c)) added += 1;
        res.json({ total_in_list: companies.length, added });
    }),
);

companiesRouter.post(
    "/companies/crawl",
    asyncHandler(async (_req, res) => {
        res.json(await runCompanyCrawl());
    }),
);

companiesRouter.post(
    "/companies/:companyId/crawl",
    asyncHandler(async (req, res) => {
        res.json(await runCompanyCrawl([req.params.companyId as string]));
    }),
);

// detect-ats and bulk discover are not implemented.
companiesRouter.post("/companies/detect-ats", (_req, res) => {
    res.json({ error: "not implemented" });
});

companiesRouter.post("/companies/discover", (_req, res) => {
    res.json({ error: "not implemented" });
});
