import { AppError } from "../../common/errors/app-error.js";
import { utcNowIso } from "../../common/utils/time.js";
import { makeCompanyId } from "./companies.model.js";
import { getAllSeedCompanies } from "./data/company-seed.js";
import { getAllMegaCompanies } from "./data/mega-companies.js";
import * as repository from "./companies.repository.js";
import type { CompanyInput } from "./companies.dto.js";

export { getCompanies, getCompanyStats } from "./companies.repository.js";

export async function getCompanyById(id: string) {
    const company = await repository.getCompanyById(id);
    if (!company) throw new AppError("COMPANY_NOT_FOUND");
    return company;
}

export async function createCompany(input: CompanyInput): Promise<string> {
    const id = makeCompanyId(input.name);
    await repository.upsertCompany({ ...input, id, last_crawled: "", crawl_status: "active" });
    return id;
}

export async function updateCompany(id: string, input: CompanyInput): Promise<void> {
    const existing = await getCompanyById(id);
    await repository.upsertCompany({ ...input, id, last_crawled: existing.last_crawled ?? "", crawl_status: existing.crawl_status ?? "active" });
}

export async function updateCompanyCrawlStatus(id: string, status: string, lastCrawled = ""): Promise<void> {
    await getCompanyById(id);
    await repository.updateCompanyCrawlStatus(id, status, lastCrawled);
}

export async function pauseCompany(id: string): Promise<void> {
    await updateCompanyCrawlStatus(id, "paused", utcNowIso());
}

export async function seedCompanies(mega = false) {
    const companies = mega ? getAllMegaCompanies() : getAllSeedCompanies();
    let added = 0;
    for (const company of companies) if (await repository.upsertCompany(company)) added += 1;
    return mega ? { total_in_list: companies.length, added } : { seeded: companies.length, added };
}

export function discoverCompanies(): never { throw new AppError("NOT_IMPLEMENTED"); }
