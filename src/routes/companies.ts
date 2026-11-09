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
import { detail, toInt, toStr } from "./util.js";

// ── Companies API ───────────────────────────
export const companiesRouter = Router();

companiesRouter.get("/companies", (req, res) => {
    const q = req.query;
    const companies = getCompanies({
        ats_platform: toStr(q.ats_platform),
        crawl_status: toStr(q.crawl_status),
        india_friendly: toStr(q.india_friendly),
        search: toStr(q.search),
        limit: toInt(q.limit, 200, 1, 500),
        offset: toInt(q.offset, 0, 0),
    });
    res.json({ companies, count: companies.length });
});

companiesRouter.get("/companies/stats", (_req, res) => {
    res.json(getCompanyStats());
});

companiesRouter.post("/companies", (req, res) => {
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
    upsertCompany(data);
    res.json({ ok: true, id: data.id });
});

companiesRouter.patch("/companies/:companyId", (req, res) => {
    const companyId = req.params.companyId as string;
    const existing = getCompanyById(companyId);
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
    upsertCompany(data);
    res.json({ ok: true });
});

companiesRouter.delete("/companies/:companyId", (req, res) => {
    updateCompanyCrawlStatus(req.params.companyId as string, "paused", utcNowIso());
    res.json({ ok: true });
});

companiesRouter.post("/companies/:companyId/activate", (req, res) => {
    updateCompanyCrawlStatus(req.params.companyId as string, "active");
    res.json({ ok: true });
});

companiesRouter.post("/companies/seed", (_req, res) => {
    const companies = getAllSeedCompanies();
    let added = 0;
    for (const c of companies) if (upsertCompany(c)) added += 1;
    res.json({ seeded: companies.length, added });
});

companiesRouter.post("/companies/mega-seed", (_req, res) => {
    const companies = getAllMegaCompanies();
    let added = 0;
    for (const c of companies) if (upsertCompany(c)) added += 1;
    res.json({ total_in_list: companies.length, added });
});

companiesRouter.post("/companies/crawl", async (_req, res) => {
    res.json(await runCompanyCrawl());
});

companiesRouter.post("/companies/:companyId/crawl", async (req, res) => {
    res.json(await runCompanyCrawl([req.params.companyId as string]));
});

// detect-ats and bulk discover are not implemented.
companiesRouter.post("/companies/detect-ats", (_req, res) => {
    res.json({ error: "not implemented" });
});

companiesRouter.post("/companies/discover", (_req, res) => {
    res.json({ error: "not implemented" });
});
