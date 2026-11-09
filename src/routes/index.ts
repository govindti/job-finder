import { Router } from "express";
import { jobsRouter } from "./jobs.js";
import { companiesRouter } from "./companies.js";
import { outreachRouter } from "./outreach.js";
import { emailRouter } from "./email.js";
import { exportRouter } from "./export.js";
import { profilesRouter } from "./profiles.js";

// All sub-routers use paths relative to /api and are mounted together here,
// matching the endpoint surface documented in the README.
export const apiRouter = Router();

apiRouter.use("/", jobsRouter);
apiRouter.use("/", companiesRouter);
apiRouter.use("/", outreachRouter);
apiRouter.use("/", emailRouter);
apiRouter.use("/", exportRouter);
apiRouter.use("/", profilesRouter);
