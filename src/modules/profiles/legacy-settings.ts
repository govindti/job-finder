// These constants power the legacy first-run profile seed. The runtime no
// longer reads them directly; they only materialise the "Backend Python
// (legacy)" starter profile when the profiles table is empty.

export const DEFAULT_SEARCH_TERMS: string[] = [
    "backend developer python",
    "python django developer",
    "fastapi developer",
    "backend engineer python",
    "python developer",
];

export const RELEVANT_TECH: string[] = [
    "python", "django", "fastapi", "flask", "celery", "redis",
    "postgresql", "postgres", "mysql", "mongodb", "docker",
    "kubernetes", "aws", "gcp", "rest", "graphql", "node",
    "nodejs", "express", "sql", "nosql", "microservices",
    "rabbitmq", "kafka", "elasticsearch",
];

export const TITLE_KEYWORDS_POSITIVE: string[] = [
    "backend", "back-end", "back end", "python", "django",
    "fastapi", "software engineer", "software developer",
    "full stack", "fullstack", "full-stack", "api developer",
];

export const TITLE_KEYWORDS_NEGATIVE: string[] = [
    "frontend", "front-end", "front end", "ios", "android",
    "mobile", "devops", "data scientist", "machine learning",
    "ml engineer", "ui/ux", "designer", "qa", "test",
    "intern", "internship", "trainee", "junior",
];

export const LOCATION_INDIA_POSITIVE: string[] = [
    "india", "asia", "worldwide", "global", "anywhere",
    "apac", "asia pacific", "asia-pacific",
    "remote - global", "remote global", "globally distributed",
    "work from anywhere", "location independent",
    "south asia", "southeast asia", "emea/apac",
    "mumbai", "bangalore", "bengaluru", "hyderabad", "pune",
    "delhi", "chennai", "kolkata", "noida", "gurgaon", "gurugram",
    "new delhi", "kochi", "jaipur", "ahmedabad", "remote - india",
    "ist", "indian standard time",
];

export const LOCATION_INDIA_NEGATIVE: string[] = [
    "us only", "usa only", "us-only", "united states only",
    "must be located in the us", "must reside in the us",
    "us-based", "us based", "u.s. only", "u.s. based",
    "canada only", "uk only", "eu only", "europe only",
    "european union only", "uk-based", "eu-based",
    "must be authorized to work in the united states",
    "no visa sponsorship", "us citizen", "us work authorization",
    "est/cst/pst", "americas only", "americas timezone",
    "north america only", "na only", "latam only",
];

export const TIMEZONE_COMPATIBLE: string[] = [
    "ist", "gmt", "utc", "cet", "eet", "ast",
    "flexible", "async", "asynchronous",
    "overlap", "any timezone", "all timezones",
];

export const TIMEZONE_INCOMPATIBLE: string[] = [
    "pst only", "est only", "cst only", "mst only",
    "pacific time only", "eastern time only",
    "us timezone required", "us hours required",
    "core hours pst", "core hours est",
];

export const MIN_RELEVANCE_SCORE = 50;
