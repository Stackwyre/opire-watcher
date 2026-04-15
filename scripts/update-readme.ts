import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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

function formatMoney(amount: number): string {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2
  }).replace('$', '');
}

function isTrulyAvailable(bounty: Bounty): boolean {
  // Must have no claimers
  if (bounty.claimer_usernames.length > 0) return false;
  
  // If we checked GitHub and it's closed, not available
  if (bounty.issue_state === "closed") return false;
  
  // If we checked GitHub and it has assignees, not available
  if (bounty.issue_github_assignees && bounty.issue_github_assignees.length > 0) return false;
  
  return true;
}

function getStatusEmoji(bounty: Bounty): string {
  if (bounty.issue_state === "closed") return "🔒closed";
  if (bounty.claimer_usernames.length > 0) {
    const claimers = bounty.claimer_usernames.join(",");
    return `👥claimed(${claimers})`;
  }
  return "❓";
}

function main(): void {
  const dataDir = resolve(process.cwd(), "data");
  const bountiesFile = resolve(dataDir, "bounties.json");
  const readmeFile = resolve(process.cwd(), "README.md");
  
  const bounties: Bounty[] = JSON.parse(readFileSync(bountiesFile, "utf8"));
  const readme = readFileSync(readmeFile, "utf8");
  
  console.log(`Loaded ${bounties.length} bounties`);
  
  // Calculate stats
  const totalBounties = bounties.length;
  const totalAmount = bounties.reduce((sum, b) => sum + b.amount_usd, 0);
  
  const trulyAvailable = bounties.filter(isTrulyAvailable);
  const availableCount = trulyAvailable.length;
  const availableAmount = trulyAvailable.reduce((sum, b) => sum + b.amount_usd, 0);
  
  // Top truly available by reward
  const topAvailable = trulyAvailable
    .sort((a, b) => b.amount_usd - a.amount_usd)
    .slice(0, 10);
  
  // Top repos by total reward
  const repoStats = new Map<string, { count: number; total: number }>();
  bounties.forEach(b => {
    if (b.project_repo_owner) {
      const current = repoStats.get(b.project_repo_owner) || { count: 0, total: 0 };
      repoStats.set(b.project_repo_owner, {
        count: current.count + 1,
        total: current.total + b.amount_usd
      });
    }
  });
  
  const topRepos = Array.from(repoStats.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);
  
  // Top languages by total reward
  const langStats = new Map<string, { count: number; total: number }>();
  bounties.forEach(b => {
    b.programming_languages.forEach(lang => {
      const current = langStats.get(lang) || { count: 0, total: 0 };
      langStats.set(lang, {
        count: current.count + 1,
        total: current.total + b.amount_usd
      });
    });
  });
  
  const topLangs = Array.from(langStats.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);
  
  // Latest 20 with status
  const latest = bounties
    .sort((a, b) => (b.created_at || b.fetched_at).localeCompare(a.created_at || a.fetched_at))
    .slice(0, 20);
  
  // Generate stats section
  const today = new Date().toISOString().split('T')[0];
  
  let statsSection = `<!-- stats-start -->

_Last updated: ${today}_

`;
  statsSection += `**Tracked total:** ${totalBounties} / **$${formatMoney(totalAmount)}** | **Truly available:** ${availableCount} / **$${formatMoney(availableAmount)}**

`;
  
  // Truly available section
  if (topAvailable.length > 0) {
    statsSection += `### 🟢 Truly available (unclaimed, by reward)\n\n`;
    topAvailable.forEach(b => {
      const title = b.title || "(no title)";
      const org = b.project_repo_owner || b.org_name || "unknown";
      const url = b.url ? ` ${b.url}` : "";
      const langs = b.programming_languages.length > 0 ? ` \`${b.programming_languages.join(",")}\`` : "";
      statsSection += `- **$${formatMoney(b.amount_usd)}** — [${title}](${b.url}) *(${org})*${langs}\n`;
    });
    statsSection += "\n";
  }
  
  // Top repos section
  if (topRepos.length > 0) {
    statsSection += `### Top repos (by total reward)\n\n`;
    statsSection += `| Repo owner | Count | Total |\n`;
    statsSection += `| --- | ---: | ---: |\n`;
    topRepos.forEach(([owner, stats]) => {
      statsSection += `| ${owner} | ${stats.count} | $${formatMoney(stats.total)} |\n`;
    });
    statsSection += "\n";
  }
  
  // Top languages section
  if (topLangs.length > 0) {
    statsSection += `### Top languages (by total reward)\n\n`;
    statsSection += `| Language | Count | Total |\n`;
    statsSection += `| --- | ---: | ---: |\n`;
    topLangs.forEach(([lang, stats]) => {
      statsSection += `| ${lang} | ${stats.count} | $${formatMoney(stats.total)} |\n`;
    });
    statsSection += "\n";
  }
  
  // Latest section
  if (latest.length > 0) {
    statsSection += `### Latest 20 (with status)\n\n`;
    latest.forEach(b => {
      const status = getStatusEmoji(b);
      const title = b.title || "(no title)";
      const org = b.project_repo_owner || b.org_name || "unknown";
      const url = b.url;
      statsSection += `- ${status} **$${formatMoney(b.amount_usd)}** — [${title}](${url}) *(${org})*\n`;
    });
    statsSection += "\n";
  }
  
  statsSection += `<!-- stats-end -->`;
  
  // Replace stats in README
  const startMarker = "<!-- stats-start -->";
  const endMarker = "<!-- stats-end -->";
  const startIndex = readme.indexOf(startMarker);
  const endIndex = readme.indexOf(endMarker) + endMarker.length;
  
  if (startIndex === -1 || endIndex === -1) {
    throw new Error("Could not find stats markers in README.md");
  }
  
  const newReadme = readme.substring(0, startIndex) + statsSection + readme.substring(endIndex);
  
  writeFileSync(readmeFile, newReadme);
  console.log("Updated README.md with latest stats");
}

if (import.meta.main) {
  main();
}