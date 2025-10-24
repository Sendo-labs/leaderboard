import { ingestWeeklyGithubData } from "./pipeline";
import { createIngestionContext } from "./context";
import { createStep, pipe } from "../types";
import { mapStep } from "../types";
import { getSelectedRepositories } from "../getSelectedRepositories";
import { fetchWalletAddresses } from "./fetchWalletAddresses";
import { fetchAndStoreXActivities } from "./storeXActivities";

export { createIngestionContext };

// GitHub data ingestion pipeline
const ingestGithubData = pipe(
  getSelectedRepositories,
  createStep("mapRepos", (repositories) => {
    return repositories.map(({ repoId, owner, name, defaultBranch }) => ({
      repository: { repoId, owner, name, defaultBranch },
    }));
  }),
  mapStep(ingestWeeklyGithubData),
  createStep("Log Project Summaries", (results, context) => {
    for (const result of results) {
      const intervals = result.intervals;
      const metadata = result.metadata;
      const totalPrs = intervals.reduce(
        (acc: number, interval: { prs: number }) => {
          return acc + interval.prs;
        },
        0,
      );
      const totalIssues = intervals.reduce(
        (acc: number, interval: { issues: number }) => {
          return acc + interval.issues;
        },
        0,
      );
      context.logger?.info(
        `Ingested ${totalPrs} total PRs and ${totalIssues} total issues across ${intervals.length} weeks for ${metadata.repository} (${metadata.stars} stars, ${metadata.forks} forks)`,
      );
    }
  }),
);

// Social data ingestion pipeline
const ingestSocialData = pipe(fetchWalletAddresses, fetchAndStoreXActivities);

// Combined ingestion pipeline
export const ingestPipeline = pipe(ingestGithubData, ingestSocialData);
