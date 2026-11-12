import { type Job } from "../../jobs/jobs.model.js";

// Common source contract. Every fetcher (job boards + company ATS crawlers)
// implements this.
export interface JobSource {
    readonly name: string;
    fetch(): Promise<Job[]>;
}

/**
 * Run a source's fetch with error isolation: a thrown error yields an empty
 * list plus a logged warning rather than aborting the whole collection pass.
 */
export async function safeFetch(
    source: JobSource,
    onError: (source: string, err: unknown) => void = () => { },
): Promise<Job[]> {
    try {
        return await source.fetch();
    } catch (err) {
        onError(source.name, err);
        return [];
    }
}
