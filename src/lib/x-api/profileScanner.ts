/**
 * GitHub Profile Scanner
 *
 * Scans GitHub profile READMEs to discover linked X accounts
 * Looks for X-LINKING-BEGIN/END markers in {username}/{username} repos
 */

import { createLogger } from "@/lib/logger";
import { parseXLinkingDataFromReadme } from "@/lib/xLinking/readmeUtils";
import {
  verifyXAccountLinking,
  getLinkingSecret,
} from "@/lib/x-api/jwtVerifier";
import pRetry from "p-retry";

const logger = createLogger({
  minLevel: "info",
  nameSegments: ["ProfileScanner"],
});

export interface LinkedXAccountFromGitHub {
  githubUsername: string;
  xUsername: string;
  xUserId: string;
  linkedAt: string;
  linkingProof: string; // JWT token
  lastUpdated: string;
}

export interface ProfileScanResult {
  linkedAccounts: LinkedXAccountFromGitHub[];
  scannedCount: number;
  failedCount: number;
  errors: Array<{ username: string; error: string }>;
}

/**
 * Fetch README content from a GitHub profile repo
 */
async function fetchProfileReadme(
  username: string,
  githubToken?: string,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${username}/${username}/contents/README.md`;

  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Sendo-Leaderboard-Scanner",
    };

    if (githubToken) {
      headers["Authorization"] = `Bearer ${githubToken}`;
    }

    const response = await pRetry(
      async () => {
        const res = await fetch(url, { headers });

        // 404 means no profile repo or no README - not an error
        if (res.status === 404) {
          return null;
        }

        // Check rate limit
        const remaining = res.headers.get("X-RateLimit-Remaining");
        if (remaining && parseInt(remaining) < 10) {
          logger.warn(
            `GitHub API rate limit low: ${remaining} requests remaining`,
          );
        }

        if (!res.ok) {
          throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
        }

        return res;
      },
      {
        retries: 3,
        minTimeout: 1000,
        maxTimeout: 5000,
        onFailedAttempt: (error) => {
          logger.debug(
            `Retry ${error.attemptNumber} for ${username}: ${error.message}`,
          );
        },
      },
    );

    if (!response) {
      return null;
    }

    const data = await response.json();

    // Decode base64 content
    if (data.content && data.encoding === "base64") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }

    return null;
  } catch (error) {
    logger.error(`Failed to fetch README for ${username}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Scan a single GitHub profile for linked X account with JWT verification
 */
export async function scanProfileForXAccount(
  username: string,
  githubToken?: string,
  options: { verifyJwt?: boolean; linkingSecret?: string } = {},
): Promise<LinkedXAccountFromGitHub | null> {
  const { verifyJwt = true, linkingSecret } = options;

  const readmeContent = await fetchProfileReadme(username, githubToken);

  if (!readmeContent) {
    return null;
  }

  // Parse X linking data from README
  const xLinkingData = parseXLinkingDataFromReadme(readmeContent);

  if (!xLinkingData) {
    return null;
  }

  // Verify JWT signature if requested
  if (verifyJwt) {
    const secret = linkingSecret || getLinkingSecret();

    const isValid = await verifyXAccountLinking(
      username,
      xLinkingData.xAccount.xUserId,
      xLinkingData.xAccount.xUsername,
      xLinkingData.xAccount.linkingProof,
      secret,
    );

    if (!isValid) {
      logger.warn(
        `Invalid JWT signature for ${username} (@${xLinkingData.xAccount.xUsername})`,
      );
      return null;
    }
  }

  return {
    githubUsername: username,
    xUsername: xLinkingData.xAccount.xUsername,
    xUserId: xLinkingData.xAccount.xUserId,
    linkedAt: xLinkingData.xAccount.linkedAt,
    linkingProof: xLinkingData.xAccount.linkingProof,
    lastUpdated: xLinkingData.lastUpdated,
  };
}

/**
 * Scan multiple GitHub profiles for linked X accounts
 *
 * @param usernames List of GitHub usernames to scan
 * @param options Configuration options
 * @returns Scan results with all discovered linked accounts
 */
export async function scanProfilesForXAccounts(
  usernames: string[],
  options: {
    githubToken?: string;
    concurrency?: number;
    onProgress?: (current: number, total: number) => void;
  } = {},
): Promise<ProfileScanResult> {
  const { githubToken, concurrency = 5, onProgress } = options;

  const linkedAccounts: LinkedXAccountFromGitHub[] = [];
  const errors: Array<{ username: string; error: string }> = [];
  let scannedCount = 0;
  let failedCount = 0;

  logger.info(`Starting profile scan for ${usernames.length} users...`);

  // Process in batches to respect rate limits
  for (let i = 0; i < usernames.length; i += concurrency) {
    const batch = usernames.slice(i, i + concurrency);

    const results = await Promise.allSettled(
      batch.map((username) => scanProfileForXAccount(username, githubToken)),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const username = batch[j];
      scannedCount++;

      if (result.status === "fulfilled") {
        if (result.value) {
          linkedAccounts.push(result.value);
          logger.debug(
            `Found X account @${result.value.xUsername} linked to ${username}`,
          );
        }
      } else {
        failedCount++;
        errors.push({
          username,
          error: result.reason?.message || "Unknown error",
        });
        logger.error(`Failed to scan ${username}:`, result.reason);
      }

      if (onProgress) {
        onProgress(scannedCount, usernames.length);
      }
    }

    // Small delay between batches to be nice to GitHub API
    if (i + concurrency < usernames.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  logger.info(
    `Profile scan complete: ${linkedAccounts.length} linked accounts found, ` +
      `${failedCount} failures out of ${scannedCount} profiles scanned`,
  );

  return {
    linkedAccounts,
    scannedCount,
    failedCount,
    errors,
  };
}

/**
 * Build a mapping of X user IDs to GitHub usernames
 *
 * This is used to quickly look up which GitHub user owns an X account
 */
export function buildXIdToGitHubMapping(
  linkedAccounts: LinkedXAccountFromGitHub[],
): Map<string, string> {
  const mapping = new Map<string, string>();

  for (const account of linkedAccounts) {
    mapping.set(account.xUserId, account.githubUsername);
  }

  return mapping;
}

/**
 * Build a mapping of X usernames to GitHub usernames
 */
export function buildXUsernameToGitHubMapping(
  linkedAccounts: LinkedXAccountFromGitHub[],
): Map<string, string> {
  const mapping = new Map<string, string>();

  for (const account of linkedAccounts) {
    mapping.set(account.xUsername.toLowerCase(), account.githubUsername);
  }

  return mapping;
}
