"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, Check, X as XIcon, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  generateReadmeXSection,
  parseXLinkingDataFromReadme,
} from "@/lib/xLinking/readmeUtils";
import { decodeBase64 } from "@/lib/decode";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useAuth } from "@/contexts/AuthContext";

const AUTH_WORKER_URL = "https://github-auth-worker.sendo-auth.workers.dev";

function XCallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token } = useAuth();
  const [copied, copyToClipboard] = useCopyToClipboard();
  const [status, setStatus] = useState<
    "loading" | "success" | "error" | "already_linked"
  >("loading");
  const [message, setMessage] = useState("Processing X authentication...");
  const [xUsername, setXUsername] = useState<string | null>(null);
  const [githubUsername, setGithubUsername] = useState<string | null>(null);
  const [xSection, setXSection] = useState<string | null>(null);
  const [readmeExists, setReadmeExists] = useState<boolean>(false);
  const [defaultBranch, setDefaultBranch] = useState<string>("main");

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
        setStatus("error");
        setMessage(
          `GitHub profile repository ${githubUsername}/${githubUsername} not found. Please create it first.`,
        );
        return;
      }

      const repoData = await repoResponse.json();
      const branch = repoData.default_branch || "main";
      setDefaultBranch(branch);

      // Step 3: Check if README exists and if X account is already linked
      const readmeUrl = `https://api.github.com/repos/${githubUsername}/${githubUsername}/contents/README.md`;
      const readmeResponse = await fetch(readmeUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      if (readmeResponse.ok) {
        setReadmeExists(true);
        const readmeData = await readmeResponse.json();
        const currentReadme = decodeBase64(readmeData.content);

        // Check if X account is already linked
        const existingXData = parseXLinkingDataFromReadme(currentReadme);
        if (existingXData) {
          setStatus("already_linked");
          setMessage(
            `X account @${existingXData.xAccount.xUsername} is already linked. You can re-link if needed.`,
          );
          return;
        }
      } else {
        setReadmeExists(false);
      }

      // Step 4: Generate X section for README
      const xSectionText = generateReadmeXSection({
        xUsername,
        xUserId,
        linkedAt,
        linkingProof,
      });

      setXSection(xSectionText);
      setStatus("success");
      setMessage(
        "X account authenticated! Copy the comment below and paste it into your GitHub profile README.",
      );
    } catch (err) {
      console.error("Error in X callback:", err);
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : "Failed to complete X linking",
      );
    }
  };

  const handleCopyAndOpenGitHub = async () => {
    if (!xSection || !githubUsername) return;

    // Copy to clipboard
    await copyToClipboard(xSection);

    // Open GitHub editor
    const githubUrl = readmeExists
      ? `https://github.com/${githubUsername}/${githubUsername}/edit/${defaultBranch}/README.md`
      : `https://github.com/${githubUsername}/${githubUsername}/new/${defaultBranch}?filename=README.md`;

    window.open(githubUrl, "_blank");
  };

  const handleRelink = () => {
    window.location.href = `${window.location.origin}/leaderboard/profile/edit`;
  };

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12">
      <div className="space-y-6">
        <div className="flex items-center justify-center">
          {status === "loading" && (
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          )}
          {status === "success" && (
            <div className="rounded-full bg-green-100 p-3">
              <Check className="h-12 w-12 text-green-600" />
            </div>
          )}
          {status === "already_linked" && (
            <div className="rounded-full bg-blue-100 p-3">
              <Check className="h-12 w-12 text-blue-600" />
            </div>
          )}
          {status === "error" && (
            <div className="rounded-full bg-red-100 p-3">
              <XIcon className="h-12 w-12 text-red-600" />
            </div>
          )}
        </div>

        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">
            {status === "loading" && "Processing..."}
            {status === "success" && "X Account Authenticated!"}
            {status === "already_linked" && "Already Linked"}
            {status === "error" && "Linking Failed"}
          </h1>
          <p className="text-muted-foreground">{message}</p>
        </div>

        {status === "success" && xSection && (
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg border border-green-500/20 bg-green-500/10 p-4">
              <p className="text-sm font-medium">
                Your X account @{xUsername} has been authenticated!
              </p>
              <p className="text-sm text-muted-foreground">
                Copy the comment below and paste it into your GitHub profile
                README to complete the linking.
              </p>
            </div>

            <div className="relative">
              <div className="rounded-md border bg-muted p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    Generated X Comment. Copy and paste this into your README.md
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(xSection)}
                    className="h-8 w-8 p-0"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words text-sm">
                  <code>{xSection}</code>
                </pre>
              </div>
            </div>

            <Button onClick={handleCopyAndOpenGitHub} className="w-full">
              <ExternalLink className="mr-2 h-4 w-4" />
              Copy and Open GitHub Editor
            </Button>

            <div className="flex justify-center gap-4">
              <Button
                variant="outline"
                onClick={() => router.push("/profile/edit")}
              >
                Return to Profile
              </Button>
            </div>
          </div>
        )}

        {status === "already_linked" && (
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

        {status === "error" && (
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
