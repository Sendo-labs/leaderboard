/**
 * X Activities Ingestion
 *
 * Fetches X posts mentioning @SendoMarket and stores them in the database
 * Maps X user IDs to GitHub usernames using README linking data
 */

import { db } from "@/lib/data/db";
import { xActivities, socialAccounts, users } from "@/lib/data/schema";
import { eq, and } from "drizzle-orm";
import {
  createXApiClient,
  buildSendoMentionQuery,
  normalizeXPost,
  NormalizedXPost,
} from "@/lib/x-api/client";
import {
  scanProfilesForXAccounts,
  buildXIdToGitHubMapping,
  LinkedXAccountFromGitHub,
} from "@/lib/x-api/profileScanner";
import { createStep } from "../types";
import { IngestionPipelineContext } from "./context";

/**
 * Determine activity type from normalized post
 */
function determineActivityType(
  post: NormalizedXPost,
): "post" | "repost" | "quote" | "reply" {
  if (post.isReply) return "reply";
  if (post.isRetweet) return "repost";
  if (post.isQuote) return "quote";
  return "post";
}

/**
 * Check if post mentions @SendoMarket
 */
function mentionsSendoMarket(post: NormalizedXPost): boolean {
  return post.mentions.some((m) => m.username.toLowerCase() === "sendomarket");
}

/**
 * Check if post is about Sendo (mentions @SendoMarket or #Sendo hashtag)
 */
function isAboutSendo(post: NormalizedXPost): boolean {
  return mentionsSendoMarket(post) || post.hashtags.some((h) => h === "sendo");
}

/**
 * Store a single X activity in the database
 */
async function storeXActivity(
  post: NormalizedXPost,
  githubUsername: string,
): Promise<void> {
  const activityType = determineActivityType(post);

  await db
    .insert(xActivities)
    .values({
      id: post.id,
      username: githubUsername,
      activityType,
      content: post.text,
      targetPostId: null, // Could be enhanced to track reply/quote targets
      targetUserId: null,
      isAboutSendo: isAboutSendo(post),
      mentionsSendoMarket: mentionsSendoMarket(post),
      hashtagsUsed: JSON.stringify(post.hashtags),
      mediaCount: post.mediaCount,
      engagementCount:
        post.likesCount +
        post.repostsCount +
        post.repliesCount +
        post.quotesCount,
      likesCount: post.likesCount,
      repostsCount: post.repostsCount,
      repliesCount: post.repliesCount,
      viewsCount: post.viewsCount,
      createdAt: post.createdAt,
      lastUpdated: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [xActivities.id],
      set: {
        // Update engagement metrics
        engagementCount:
          post.likesCount +
          post.repostsCount +
          post.repliesCount +
          post.quotesCount,
        likesCount: post.likesCount,
        repostsCount: post.repostsCount,
        repliesCount: post.repliesCount,
        viewsCount: post.viewsCount,
        lastUpdated: new Date().toISOString(),
      },
    });
}

/**
 * Sync linked X account to socialAccounts table
 */
async function syncSocialAccount(
  linkedAccount: LinkedXAccountFromGitHub,
): Promise<void> {
  // First ensure the user exists
  await db
    .insert(users)
    .values({
      username: linkedAccount.githubUsername,
      avatarUrl: "",
      isBot: 0,
    })
    .onConflictDoNothing();

  // Check if account already exists
  const existing = await db.query.socialAccounts.findFirst({
    where: and(
      eq(socialAccounts.userId, linkedAccount.githubUsername),
      eq(socialAccounts.platform, "x"),
    ),
  });

  if (existing) {
    // Update existing account
    await db
      .update(socialAccounts)
      .set({
        platformUsername: linkedAccount.xUsername,
        lastSyncedAt: new Date().toISOString(),
        updatedAt: linkedAccount.lastUpdated,
      })
      .where(eq(socialAccounts.id, existing.id));
  } else {
    // Insert new account
    await db.insert(socialAccounts).values({
      userId: linkedAccount.githubUsername,
      platform: "x",
      platformUserId: linkedAccount.xUserId,
      platformUsername: linkedAccount.xUsername,
      displayName: linkedAccount.xUsername,
      profileUrl: `https://x.com/${linkedAccount.xUsername}`,
      isVerified: true, // Verified via JWT
      isPrimary: true,
      isActive: true,
      verificationMethod: "oauth_jwt",
      lastSyncedAt: new Date().toISOString(),
      createdAt: linkedAccount.linkedAt,
      updatedAt: linkedAccount.lastUpdated,
    });
  }
}

/**
 * Fetch and store X activities for a date range
 */
const fetchAndStoreXActivitiesStep = createStep(
  "fetchAndStoreXActivities",
  async (_input: unknown, context: IngestionPipelineContext) => {
    const { logger: contextLogger, dateRange } = context;
    const stepLogger = contextLogger?.child("X Activities");

    stepLogger?.info("Starting X activities ingestion...");

    try {
      // Step 1: Get all active GitHub usernames from the database
      stepLogger?.info("Fetching active GitHub users...");
      const activeUsers = await db.query.users.findMany({
        where: eq(users.isBot, 0),
        columns: {
          username: true,
        },
      });

      const usernames = activeUsers.map((u) => u.username);
      stepLogger?.info(`Found ${usernames.length} active users to scan`);

      // Step 2: Scan GitHub profiles for linked X accounts
      stepLogger?.info("Scanning GitHub profiles for linked X accounts...");
      const scanResult = await scanProfilesForXAccounts(usernames, {
        githubToken: process.env.GITHUB_TOKEN,
        concurrency: 10,
        onProgress: (current, total) => {
          if (current % 50 === 0) {
            stepLogger?.debug(`Profile scan progress: ${current}/${total}`);
          }
        },
      });

      stepLogger?.info(
        `Found ${scanResult.linkedAccounts.length} linked X accounts`,
      );

      if (scanResult.linkedAccounts.length === 0) {
        stepLogger?.warn(
          "No linked X accounts found, skipping X activity fetch",
        );
        return {
          count: 0,
          linkedAccounts: 0,
          posts: 0,
        };
      }

      // Step 3: Sync linked accounts to socialAccounts table
      stepLogger?.info("Syncing linked accounts to database...");
      await Promise.all(
        scanResult.linkedAccounts.map((account) => syncSocialAccount(account)),
      );

      // Step 4: Build X ID to GitHub username mapping
      const xIdToGitHub = buildXIdToGitHubMapping(scanResult.linkedAccounts);

      // Step 5: Fetch X posts mentioning @SendoMarket
      // STRATEGY: Global search (NOT per-user) for scalability
      // - 1 API call instead of N (number of users)
      // - Filter results by linked accounts afterwards
      // - Filter by dateRange to avoid re-processing old data
      // This approach scales well: same cost for 10 or 1000 users
      stepLogger?.info(
        "Fetching X posts mentioning @SendoMarket (global search)...",
      );
      const xClient = createXApiClient();

      const query = buildSendoMentionQuery({
        excludeRetweets: true, // Don't count pure retweets
        excludeReplies: false, // Include replies
      });

      let allPosts: NormalizedXPost[] = [];
      let cursor: string | undefined;
      let pageCount = 0;

      // Fetch up to 500 posts (5 pages of 100)
      // Note: If there are >500 recent posts, older posts may be missed
      // This is acceptable as we run daily and can catch them retroactively
      do {
        const response = await xClient.searchTweets({
          query,
          limit: 100,
          cursor,
        });

        if (!response.data?.tweets || response.data.tweets.length === 0) {
          break;
        }

        const normalizedPosts = response.data.tweets.map(normalizeXPost);
        allPosts = allPosts.concat(normalizedPosts);

        cursor = response.data.cursor;
        pageCount++;

        stepLogger?.debug(
          `Fetched page ${pageCount}: ${normalizedPosts.length} posts`,
        );

        // Respect rate limits (1s between pages)
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } while (cursor && pageCount < 5);

      stepLogger?.info(
        `Fetched ${allPosts.length} total posts from X API (${pageCount} pages)`,
      );

      // Step 6: Filter posts by linked accounts and date range
      let storedCount = 0;
      let skippedCount = 0;

      for (const post of allPosts) {
        // Check if post author has linked their X account
        const githubUsername = xIdToGitHub.get(post.authorId);
        if (!githubUsername) {
          skippedCount++;
          continue;
        }

        // Filter by date range if provided
        if (dateRange && dateRange.startDate && dateRange.endDate) {
          const postDate = new Date(post.createdAt);
          const startDate = new Date(dateRange.startDate);
          const endDate = new Date(dateRange.endDate);

          if (postDate < startDate || postDate > endDate) {
            skippedCount++;
            continue;
          }
        }

        // Store activity
        await storeXActivity(post, githubUsername);
        storedCount++;
      }

      stepLogger?.info(
        `Stored ${storedCount} X activities (${skippedCount} skipped - no linked account or outside date range)`,
      );

      return {
        count: storedCount,
        linkedAccounts: scanResult.linkedAccounts.length,
        posts: allPosts.length,
        skipped: skippedCount,
      };
    } catch (error) {
      stepLogger?.error("Error fetching X activities", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
);

// Export as the main pipeline step
export const fetchAndStoreXActivities = fetchAndStoreXActivitiesStep;
