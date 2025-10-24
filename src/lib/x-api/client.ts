/**
 * X (Twitter) API Client using twitterapi.io
 *
 * Docs: https://docs.twitterapi.io/
 * This is a scraping API that doesn't require official X API credentials
 */

export interface XPost {
  rest_id: string; // Tweet ID
  legacy: {
    full_text: string;
    created_at: string; // "Wed Oct 10 20:19:24 +0000 2018"
    favorite_count: number;
    retweet_count: number;
    reply_count: number;
    quote_count: number;
    bookmark_count: number;
    entities: {
      hashtags: Array<{ text: string }>;
      user_mentions: Array<{ screen_name: string; id_str: string }>;
      urls: Array<{ url: string; expanded_url: string }>;
      media?: Array<{
        type: "photo" | "video" | "animated_gif";
        media_url_https: string;
      }>;
    };
    retweeted_status_id_str?: string; // If it's a retweet
    quoted_status_id_str?: string; // If it's a quote tweet
    in_reply_to_status_id_str?: string; // If it's a reply
    in_reply_to_user_id_str?: string;
  };
  core?: {
    user_results: {
      result: {
        rest_id: string;
        legacy: {
          screen_name: string;
          name: string;
          verified: boolean;
        };
      };
    };
  };
  views?: {
    count?: string; // View count as string
  };
}

export interface XUser {
  rest_id: string;
  legacy: {
    screen_name: string;
    name: string;
    verified: boolean;
    profile_image_url_https: string;
    followers_count: number;
    friends_count: number;
  };
}

export interface TwitterApiIoResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

/**
 * X API Client Configuration
 */
export interface XApiConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

/**
 * X API Client for fetching posts using twitterapi.io
 */
export class XApiClient {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  constructor(config: XApiConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.twitterapi.io";
    this.timeout = config.timeout || 60000; // 60s timeout for scraping API
  }

  /**
   * Make authenticated request to twitterapi.io
   */
  private async makeRequest<T>(
    endpoint: string,
    params?: Record<string, string | number>,
  ): Promise<TwitterApiIoResponse<T>> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        headers: {
          "x-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          `twitterapi.io error (${response.status}): ${data.error || data.message || JSON.stringify(data)}`,
        );
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `twitterapi.io request timeout after ${this.timeout}ms`,
        );
      }
      throw error;
    }
  }

  /**
   * Search for tweets matching a query
   *
   * Endpoint: /twitter/tweet/advanced_search
   * Docs: https://docs.twitterapi.io/api-reference/endpoint/tweet_advanced_search
   *
   * Query examples:
   * - "@SendoMarket" - mentions
   * - "from:SendoMarket" - tweets from user
   * - "#Sendo" - hashtag search
   * - "@SendoMarket -filter:retweets" - exclude retweets
   */
  async searchTweets(params: {
    query: string;
    limit?: number; // Pagination limit (note: API returns ~20 tweets per page)
    cursor?: string; // Pagination cursor (use "" for first page)
  }): Promise<
    TwitterApiIoResponse<{
      tweets: XPost[];
      next_cursor?: string;
      has_next_page?: boolean;
    }>
  > {
    const response = await this.makeRequest<{
      tweets: XPost[];
      next_cursor?: string;
      has_next_page?: boolean;
    }>("/twitter/tweet/advanced_search", {
      query: params.query,
      queryType: "Latest", // Required: "Latest" or "Top"
      cursor: params.cursor || "", // Empty string for first page
    });

    // Normalize response to match expected format
    return {
      data: {
        tweets: response.data?.tweets || [],
        next_cursor: response.data?.next_cursor,
        has_next_page: response.data?.has_next_page,
      },
    };
  }

  /**
   * Get tweets from a specific user
   *
   * Endpoint: /user/timeline
   * Docs: https://docs.twitterapi.io/endpoints/user-timeline
   */
  async getUserTweets(params: {
    username: string;
    limit?: number;
    cursor?: string;
  }): Promise<TwitterApiIoResponse<{ tweets: XPost[]; cursor?: string }>> {
    return await this.makeRequest<{ tweets: XPost[]; cursor?: string }>(
      "/user/timeline",
      {
        username: params.username,
        limit: params.limit || 100,
        ...(params.cursor && { cursor: params.cursor }),
      },
    );
  }

  /**
   * Get user information by username
   *
   * Endpoint: /user/by/username/{username}
   * Docs: https://docs.twitterapi.io/endpoints/user-by-username
   */
  async getUserByUsername(
    username: string,
  ): Promise<TwitterApiIoResponse<{ user: XUser }>> {
    return await this.makeRequest<{ user: XUser }>(
      `/user/by/username/${username}`,
    );
  }

  /**
   * Get single tweet by ID
   *
   * Endpoint: /tweet/by/id/{id}
   * Docs: https://docs.twitterapi.io/endpoints/tweet-by-id
   */
  async getTweet(
    tweetId: string,
  ): Promise<TwitterApiIoResponse<{ tweet: XPost }>> {
    return await this.makeRequest<{ tweet: XPost }>(`/tweet/by/id/${tweetId}`);
  }
}

/**
 * Create X API client from environment variables
 */
export function createXApiClient(): XApiClient {
  const apiKey = process.env.TWITTER_API_IO_KEY;

  if (!apiKey) {
    throw new Error(
      "TWITTER_API_IO_KEY environment variable is required. " +
        "Get one at https://twitterapi.io/",
    );
  }

  return new XApiClient({ apiKey });
}

/**
 * Helper to build search query for SendoMarket mentions
 */
export function buildSendoMentionQuery(
  options: {
    excludeRetweets?: boolean;
    excludeReplies?: boolean;
  } = {},
): string {
  const parts = ["@SendoMarket"];

  // Exclude pure retweets
  if (options.excludeRetweets !== false) {
    parts.push("-filter:retweets");
  }

  // Exclude replies
  if (options.excludeReplies) {
    parts.push("-filter:replies");
  }

  return parts.join(" ");
}

/**
 * Parse Twitter date format to ISO string
 * Input: "Wed Oct 10 20:19:24 +0000 2018"
 * Output: "2018-10-10T20:19:24.000Z"
 */
export function parseTwitterDate(twitterDate: string): string {
  return new Date(twitterDate).toISOString();
}

/**
 * Normalize XPost from twitterapi.io to a simpler format
 */
export interface NormalizedXPost {
  id: string;
  text: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  createdAt: string; // ISO format
  likesCount: number;
  repostsCount: number;
  repliesCount: number;
  quotesCount: number;
  viewsCount: number;
  bookmarksCount: number;
  isRetweet: boolean;
  isQuote: boolean;
  isReply: boolean;
  hashtags: string[];
  mentions: Array<{ username: string; id: string }>;
  mediaCount: number;
}

export function normalizeXPost(post: XPost): NormalizedXPost {
  const authorId = post.core?.user_results?.result?.rest_id || "unknown_author";
  const authorUsername =
    post.core?.user_results?.result?.legacy?.screen_name || "unknown_username";
  const authorName =
    post.core?.user_results?.result?.legacy?.name || authorUsername;

  return {
    id: post.rest_id,
    text: post.legacy.full_text,
    authorId,
    authorUsername,
    authorName,
    createdAt: parseTwitterDate(post.legacy.created_at),
    likesCount: post.legacy.favorite_count,
    repostsCount: post.legacy.retweet_count,
    repliesCount: post.legacy.reply_count || 0,
    quotesCount: post.legacy.quote_count || 0,
    viewsCount: post.views?.count ? parseInt(post.views.count, 10) : 0,
    bookmarksCount: post.legacy.bookmark_count || 0,
    isRetweet: !!post.legacy.retweeted_status_id_str,
    isQuote: !!post.legacy.quoted_status_id_str,
    isReply:
      !!post.legacy.in_reply_to_status_id_str ||
      !!post.legacy.in_reply_to_user_id_str,
    hashtags:
      post.legacy.entities.hashtags?.map((h) => h.text.toLowerCase()) || [],
    mentions:
      post.legacy.entities.user_mentions?.map((m) => ({
        username: m.screen_name.toLowerCase(),
        id: m.id_str,
      })) || [],
    mediaCount: post.legacy.entities.media?.length || 0,
  };
}
