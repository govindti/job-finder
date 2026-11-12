// Minimal company shape the ATS crawlers need — the subset of a company row
// that the Greenhouse/Lever/Ashby/HTML sources read.
export interface AtsCompany {
    id: string;
    name: string;
    domain: string;
    careers_url: string;
    ats_slug: string;
}
