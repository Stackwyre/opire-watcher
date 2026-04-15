import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ENDPOINT = "https://api.opire.dev/rewards?page=1&itemsPerPage=100";

type User = { id: string; username: string; avatarURL: string };
type Bounty = {
  id: string;
  amount_usd: number;
  title: string | null;
  url: string | null;
  platform: string;
  org_name: string | null;
  org_url: string | null;
  project_name: string | null;
  project_url: string | null;
  project_repo_owner: string | null;
  programming_languages: string[];
  claimer_usernames: string[];
  trying_usernames: string[];
  created_at: string | null;
  fetched_at: string;
  issue_state?: "open" | "closed" | "unknown";
  issue_github_assignees?: string[];
  availability_checked_at?: string;
};

async function checkIssue(
  url: string | null,
  token: string | undefined,
): Promise<{ state: "open" | "closed" | "unknown"; assignees: string[] } | null> {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/i);
  if (!m) return null;
  const [, owner, repo, num] = m;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${num}`, {
      headers: {
        "user-agent": "opire-watcher",
        accept: "application/vnd.github+json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return { state: "unknown", assignees: [] };
    const j = (await res.json()) as any;
    return {
      state: j.state === "closed" ? "closed" : j.state === "open" ? "open" : "unknown",
      assignees: (j.assignees ?? []).map((a: any) => a.login),
    };
  } catch {
    return { state: "unknown", assignees: [] };
  }
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  
  console.log("Fetching bounties from Opire...");
  const res = await fetch(ENDPOINT, {
    headers: { "user-agent": "opire-watcher" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
  }
  
  const data = (await res.json()) as any;
  const bounties: Bounty[] = data["hydra:member"] || [];
  
  console.log(`Found ${bounties.length} bounties`);
  
  // Add fetched_at timestamp and check issue states
  const now = new Date().toISOString();
  for (const bounty of bounties) {
    bounty.fetched_at = now;
    
    // Check GitHub issue state if it's a GitHub URL
    const issueInfo = await checkIssue(bounty.url, token);
    if (issueInfo) {
      bounty.issue_state = issueInfo.state;
      bounty.issue_github_assignees = issueInfo.assignees;
      bounty.availability_checked_at = now;
    }
  }
  
  const dataDir = resolve(process.cwd(), "data");
  const bountiesFile = resolve(dataDir, "bounties.json");
  const newBountiesFile = resolve(dataDir, "new-bounties.json");
  
  // Load existing bounties to find new ones
  let existingBounties: Bounty[] = [];
  if (existsSync(bountiesFile)) {
    try {
      existingBounties = JSON.parse(readFileSync(bountiesFile, "utf8"));
    } catch {
      console.warn("Could not parse existing bounties.json");
    }
  }
  
  const existingIds = new Set(existingBounties.map(b => b.id));
  const newBounties = bounties.filter(b => !existingIds.has(b.id));
  
  console.log(`New bounties: ${newBounties.length}`);
  
  // Save all bounties
  writeFileSync(bountiesFile, JSON.stringify(bounties, null, 2));
  
  // Save new bounties for notification
  writeFileSync(newBountiesFile, JSON.stringify(newBounties, null, 2));
  
  console.log(`Saved ${bounties.length} bounties to ${bountiesFile}`);
  console.log(`Saved ${newBounties.length} new bounties to ${newBountiesFile}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}