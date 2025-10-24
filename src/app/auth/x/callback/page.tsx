"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, Check, X as XIcon, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import {
  generateUpdatedReadmeWithXInfo,
  parseXLinkingDataFromReadme,
} from "@/lib/xLinking/readmeUtils";
import { decodeBase64 } from "@/lib/decode";

const AUTH_WORKER_URL = "https://github-auth-worker.sendo-auth.workers.dev";

function XCallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token } = useAuth();
  const [status, setStatus] = useState<
    "loading" | "success" | "error" | "already_linked"
  >("loading");
  const [message, setMessage] = useState("Processing X authentication...");
  const [xUsername, setXUsername] = useState<string | null>(null);
  const [githubUsername, setGithubUsername] = useState<string | null>(null);
  const [isWritingToReadme, setIsWritingToReadme] = useState(false);

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      setStatus("error");
      setMessage(`X authentication error: ${error}`);
      return;
    }

    if (!code || !state) {
      setStatus("error");
      setMessage("Missing OAuth parameters");
      return;
    }

    handleCallback(code, state);
  }, [searchParams]);

  const handleCallback = async (code: string, state: string) => {
    try {
      // Step 1: Exchange code for JWT from auth-worker
      const response = await fetch(
        `${AUTH_WORKER_URL}/api/x/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to complete X linking");
      }

      const data = await response.json();
      const { linkingProof, xUsername, githubUsername, xUserId, linkedAt } =
        data;

      setXUsername(xUsername);
      setGithubUsername(githubUsername);

      // Get GitHub token from auth context
      if (!token) {
        throw new Error("Not authenticated with GitHub");
      }

      // Step 2: Check if user has GitHub profile repo
      const repoUrl = `https://api.github.com/repos/${githubUsername}/${githubUsername}`;
      const repoResponse = await fetch(repoUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!repoResponse.ok) {
        const repoError = await repoResponse.text();
        console.error("Repo fetch error:", repoError);
        setStatus("error");
        setMessage(
          `GitHub profile repository ${githubUsername}/${githubUsername} not found. Please create it first.`,
        );
        return;
      }

      const repoData = await repoResponse.json();
      const defaultBranch = repoData.default_branch || "main";

      // Step 3: Fetch current README
      const readmeUrl = `https://api.github.com/repos/${githubUsername}/${githubUsername}/contents/README.md`;
      const readmeResponse = await fetch(readmeUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      let currentReadme = "";
      let readmeSha: string | undefined;

      if (readmeResponse.ok) {
        const readmeData = await readmeResponse.json();
        currentReadme = decodeBase64(readmeData.content);
        readmeSha = readmeData.sha;

        // Check if X account is already linked
        const existingXData = parseXLinkingDataFromReadme(currentReadme);
        if (existingXData) {
          setStatus("already_linked");
          setMessage(
            `X account @${existingXData.xAccount.xUsername} is already linked. You can re-link if needed.`,
          );
          return;
        }
      }

      // Step 4: Generate updated README with X linking data
      const { updatedReadme } = generateUpdatedReadmeWithXInfo(currentReadme, {
        xUsername,
        xUserId,
        linkedAt,
        linkingProof,
      });

      // Step 5: Write to GitHub README
      setIsWritingToReadme(true);
      setMessage("Writing to your GitHub README...");

      if (!token) {
        throw new Error("Not authenticated with GitHub");
      }

      const commitResponse = await fetch(readmeUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `Link X account @${xUsername} to GitHub profile`,
          content: btoa(
            new TextEncoder()
              .encode(updatedReadme)
              .reduce((data, byte) => data + String.fromCharCode(byte), ""),
          ) /* Base64 encode */,
          sha: readmeSha,
          branch: defaultBranch,
        }),
      });

      if (!commitResponse.ok) {
        const errorData = await commitResponse.json();
        console.error("Commit failed:", errorData);
        throw new Error(
          errorData.message ||
            `Failed to commit README changes: ${commitResponse.status} ${commitResponse.statusText}`,
        );
      }

      setStatus("success");
      setMessage("X account linked and README updated successfully!");

      // Redirect to profile edit page after 2 seconds
      setTimeout(() => {
        router.push("/profile/edit");
      }, 2000);
    } catch (err) {
      console.error("Error in X callback:", err);
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : "Failed to complete X linking",
      );
    } finally {
      setIsWritingToReadme(false);
    }
  };

  const handleRelink = async () => {
    if (!token || !xUsername || !githubUsername) return;

    setIsWritingToReadme(true);
    setMessage("Re-linking X account...");

    try {
      // Restart the OAuth flow
      window.location.href = `${window.location.origin}/leaderboard/profile/edit`;
    } catch (err) {
      setIsWritingToReadme(false);
      setStatus("error");
      setMessage("Failed to restart linking process");
    }
  };

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12">
      <div className="space-y-6">
        <div className="flex items-center justify-center">
          {(status === "loading" || isWritingToReadme) && (
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          )}
          {status === "success" && !isWritingToReadme && (
            <div className="rounded-full bg-green-100 p-3">
              <Check className="h-12 w-12 text-green-600" />
            </div>
          )}
          {status === "already_linked" && !isWritingToReadme && (
            <div className="rounded-full bg-blue-100 p-3">
              <Link2 className="h-12 w-12 text-blue-600" />
            </div>
          )}
          {status === "error" && !isWritingToReadme && (
            <div className="rounded-full bg-red-100 p-3">
              <XIcon className="h-12 w-12 text-red-600" />
            </div>
          )}
        </div>

        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">
            {(status === "loading" || isWritingToReadme) && "Processing..."}
            {status === "success" && !isWritingToReadme && "X Account Linked!"}
            {status === "already_linked" &&
              !isWritingToReadme &&
              "Already Linked"}
            {status === "error" && !isWritingToReadme && "Linking Failed"}
          </h1>
          <p className="text-muted-foreground">{message}</p>
        </div>

        {status === "success" && !isWritingToReadme && (
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg border border-green-500/20 bg-green-500/10 p-4">
              <p className="text-sm font-medium">
                Your X account @{xUsername} has been linked to GitHub account{" "}
                {githubUsername}
              </p>

              <div className="space-y-1 text-xs text-muted-foreground">
                <p>✓ X account authenticated</p>
                <p>✓ Linking proof generated</p>
                <p>✓ README.md updated automatically</p>
                <p>✓ Changes committed to your profile repository</p>
              </div>

              <p className="text-sm text-muted-foreground">
                You can now start earning points for posts mentioning
                @SendoMarket!
              </p>
            </div>

            <div className="flex justify-center gap-4">
              <Button onClick={() => router.push("/profile/edit")}>
                Return to Profile
              </Button>
              <Button variant="outline" onClick={() => router.push("/")}>
                View Leaderboard
              </Button>
            </div>
          </div>
        )}

        {status === "already_linked" && !isWritingToReadme && (
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
              <p className="text-sm font-medium">
                An X account is already linked in your README
              </p>
              <p className="text-sm text-muted-foreground">
                You can re-link your X account if you want to update the linking
                information.
              </p>
            </div>

            <div className="flex justify-center gap-4">
              <Button onClick={handleRelink}>Re-link X Account</Button>
              <Button
                variant="outline"
                onClick={() => router.push("/profile/edit")}
              >
                Return to Profile
              </Button>
            </div>
          </div>
        )}

        {status === "error" && !isWritingToReadme && (
          <div className="flex justify-center">
            <Button onClick={() => router.push("/profile/edit")}>
              Return to Profile
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function XCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto max-w-2xl px-4 py-12">
          <div className="flex items-center justify-center">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          </div>
        </div>
      }
    >
      <XCallbackContent />
    </Suspense>
  );
}
