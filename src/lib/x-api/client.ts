/**
 * X (Twitter) API Client using twitterapi.io
 *
 * Docs: https://docs.twitterapi.io/
 * This is a scraping API that doesn't require official X API credentials
 */

export interface XPost {
  id: string;
  text: string;
  createdAt: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  bookmarkCount: number;
  viewCount: number;
  isReply: boolean;
  inReplyToId: string | null;
  inReplyToUserId: string | null;
  inReplyToUsername: string | null;
  conversationId: string;
  entities: {
    hashtags?: Array<{ text: string }>;
    user_mentions?: Array<{ screen_name: string; id_str: string }>;
    urls?: Array<{ url: string; expanded_url: string }>;
    media?: Array<{
      type: "photo" | "video" | "animated_gif";
      media_url_https: string;
    }>;
  };
  retweeted_tweet: XPost | null;
  quoted_tweet: XPost | null;
  author: {
    id: string;
    userName: string;
    name: string;
    isVerified: boolean;
    isBlueVerified: boolean;
    profilePicture: string;
    followers: number;
    following: number;
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
  ): Promise<T> {
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

    // API returns tweets directly, not wrapped in data
    return {
      data: {
        tweets: response.tweets || [],
        next_cursor: response.next_cursor,
        has_next_page: response.has_next_page,
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
    const response = await this.makeRequest<{
      tweets: XPost[];
      cursor?: string;
    }>("/user/timeline", {
      username: params.username,
      limit: params.limit || 100,
      ...(params.cursor && { cursor: params.cursor }),
    });

    return {
      data: response,
    };
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
    const response = await this.makeRequest<{ user: XUser }>(
      `/user/by/username/${username}`,
    );

    return {
      data: response,
    };
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
    const response = await this.makeRequest<{ tweet: XPost }>(
      `/tweet/by/id/${tweetId}`,
    );

    return {
      data: response,
    };
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
 * Helper to build search query for SendoMarket mentions and retweets
 *
 * This query captures:
 * 1. Posts mentioning @SendoMarket
 * 2. Posts from @SendoMarket account
 * 3. All retweets of the above (pure retweets included via include:nativeretweets)
 * 4. Replies to @SendoMarket (optional)
 */
export function buildSendoMentionQuery(
  options: {
    excludeReplies?: boolean;
  } = {},
): string {
  // Combine mentions and from:SendoMarket to capture both mentions and original posts
  // include:nativeretweets ensures we capture pure retweets (without added text)
  const parts = ["@SendoMarket OR from:SendoMarket include:nativeretweets"];

  // Exclude replies if requested
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
  return {
    id: post.id,
    text: post.text,
    authorId: post.author.id,
    authorUsername: post.author.userName,
    authorName: post.author.name,
    createdAt: parseTwitterDate(post.createdAt),
    likesCount: post.likeCount,
    repostsCount: post.retweetCount,
    repliesCount: post.replyCount || 0,
    quotesCount: post.quoteCount || 0,
    viewsCount: post.viewCount || 0,
    bookmarksCount: post.bookmarkCount || 0,
    isRetweet: !!post.retweeted_tweet,
    isQuote: !!post.quoted_tweet,
    isReply: post.isReply,
    hashtags: post.entities.hashtags?.map((h) => h.text.toLowerCase()) || [],
    mentions:
      post.entities.user_mentions?.map((m) => ({
        username: m.screen_name.toLowerCase(),
        id: m.id_str,
      })) || [],
    mediaCount: post.entities.media?.length || 0,
  };
}
