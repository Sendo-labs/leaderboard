/**
 * X (Twitter) Scoring Calculator
 *
 * Calculates points for X activities based on content creation
 * Note: We do NOT score based on engagement received (likes/retweets)
 * to keep scoring fair for all users regardless of follower count
 */

import { xActivities } from "@/lib/data/schema";
import { groupBy } from "@/lib/arrayHelpers";
import { toDateString } from "@/lib/date-utils";
import { UTCDate } from "@date-fns/utc";

export interface XScoringConfig {
  post: {
    base: number; // Base points for original post
    mentionsSendoMarket: number; // Multiplier if mentions @SendoMarket
    usesHashtag: number; // Multiplier if uses #Sendo
    hasMedia: number; // Multiplier if has images/videos
  };
  quote: {
    base: number; // Base points for quote tweet
  };
  reply: {
    base: number; // Base points for reply
  };
  repost: {
    base: number; // Base points for retweet
  };
  daily: {
    maxPosts: number; // Max posts counted per day
    diminishingReturnsThreshold: number; // After this many posts, apply penalty
    diminishingReturnsPenalty: number; // Penalty per post (e.g., 0.8 = -20%)
    maxPointsPerDay: number; // Maximum total points from X per day
  };
}

// Default scoring configuration
// Note: Social scores are intentionally lower than GitHub contributions
// to maintain focus on code contributions as the primary metric
export const DEFAULT_X_SCORING: XScoringConfig = {
  post: {
    base: 5,
    mentionsSendoMarket: 1.5, // +50%
    usesHashtag: 1.1, // +10%
    hasMedia: 1.2, // +20%
  },
  quote: {
    base: 4,
  },
  reply: {
    base: 2,
  },
  repost: {
    base: 1,
  },
  daily: {
    maxPosts: 15,
    diminishingReturnsThreshold: 3,
    diminishingReturnsPenalty: 0.7,
    maxPointsPerDay: 25,
  },
};

export interface XScoreResult {
  totalScore: number;
  socialScore: number; // Alias for totalScore (for consistency)
  metrics: {
    posts: {
      total: number;
      original: number;
      quotes: number;
      replies: number;
      reposts: number;
    };
    engagement: {
      totalMentions: number; // How many times user mentioned @SendoMarket
      withHashtag: number; // Posts with #Sendo
      withMedia: number; // Posts with images/videos
    };
  };
}

/**
 * Calculate score for a single X activity
 */
function calculateActivityScore(
  activity: typeof xActivities.$inferSelect,
  config: XScoringConfig,
  positionInDay: number, // Position in daily posts (for diminishing returns)
): number {
  let baseScore = 0;

  // Determine base score by activity type
  switch (activity.activityType) {
    case "post":
      baseScore = config.post.base;
      break;
    case "quote":
      baseScore = config.quote.base;
      break;
    case "reply":
      baseScore = config.reply.base;
      break;
    case "repost":
      baseScore = config.repost.base;
      break;
    default:
      return 0;
  }

  // Apply multipliers for posts
  if (activity.activityType === "post") {
    let multiplier = 1.0;

    // Mentions @SendoMarket
    if (activity.mentionsSendoMarket) {
      multiplier *= config.post.mentionsSendoMarket;
    }

    // Uses #Sendo hashtag
    const hashtags: string[] = activity.hashtagsUsed
      ? JSON.parse(activity.hashtagsUsed)
      : [];
    if (hashtags.includes("sendo")) {
      multiplier *= config.post.usesHashtag;
    }

    // Has media (images/videos)
    if ((activity.mediaCount || 0) > 0) {
      multiplier *= config.post.hasMedia;
    }

    baseScore *= multiplier;
  }

  // Apply diminishing returns after threshold
  if (positionInDay > config.daily.diminishingReturnsThreshold) {
    const postsOverThreshold =
      positionInDay - config.daily.diminishingReturnsThreshold;
    const penalty = Math.pow(
      config.daily.diminishingReturnsPenalty,
      postsOverThreshold,
    );
    baseScore *= penalty;
  }

  return baseScore;
}

/**
 * Calculate X score for a user's activities
 */
export function calculateXScore(
  activities: (typeof xActivities.$inferSelect)[],
  config: XScoringConfig = DEFAULT_X_SCORING,
): XScoreResult {
  let totalScore = 0;

  // Metrics
  const metrics = {
    posts: {
      total: activities.length,
      original: 0,
      quotes: 0,
      replies: 0,
      reposts: 0,
    },
    engagement: {
      totalMentions: 0,
      withHashtag: 0,
      withMedia: 0,
    },
  };

  // Group activities by date for daily caps and diminishing returns
  const activitiesByDate = groupBy(activities, (activity) => {
    const date = new UTCDate(activity.createdAt);
    return toDateString(date);
  });

  // Calculate score for each day
  for (const [_date, dayActivities] of Object.entries(activitiesByDate)) {
    // Sort by creation time (oldest first)
    const sortedActivities = dayActivities.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    // Apply daily cap
    const cappedActivities = sortedActivities.slice(0, config.daily.maxPosts);

    let dayScore = 0;

    // Calculate score for each activity
    cappedActivities.forEach((activity, index) => {
      const activityScore = calculateActivityScore(
        activity,
        config,
        index + 1, // Position starts at 1
      );
      dayScore += activityScore;

      // Update metrics
      switch (activity.activityType) {
        case "post":
          metrics.posts.original++;
          break;
        case "quote":
          metrics.posts.quotes++;
          break;
        case "reply":
          metrics.posts.replies++;
          break;
        case "repost":
          metrics.posts.reposts++;
          break;
      }

      if (activity.mentionsSendoMarket) {
        metrics.engagement.totalMentions++;
      }

      const hashtags: string[] = activity.hashtagsUsed
        ? JSON.parse(activity.hashtagsUsed)
        : [];
      if (hashtags.includes("sendo")) {
        metrics.engagement.withHashtag++;
      }

      if ((activity.mediaCount || 0) > 0) {
        metrics.engagement.withMedia++;
      }
    });

    // Apply daily cap
    dayScore = Math.min(dayScore, config.daily.maxPointsPerDay);

    totalScore += dayScore;
  }

  return {
    totalScore: Math.round(totalScore * 100) / 100, // Round to 2 decimals
    socialScore: Math.round(totalScore * 100) / 100,
    metrics,
  };
}

/**
 * Get X activities for a user within a date range
 */
export async function getContributorXActivities(
  username: string,
  startDate: string,
  endDate: string,
): Promise<(typeof xActivities.$inferSelect)[]> {
  const { db } = await import("@/lib/data/db");
  const { eq, and, gte, lte } = await import("drizzle-orm");

  const activities = await db.query.xActivities.findMany({
    where: and(
      eq(xActivities.username, username),
      gte(xActivities.createdAt, startDate),
      lte(xActivities.createdAt, endDate),
    ),
    orderBy: (xActivities, { asc }) => [asc(xActivities.createdAt)],
  });

  return activities;
}
