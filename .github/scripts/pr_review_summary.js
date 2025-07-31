const { Octokit } = require("@octokit/core");
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const owner = process.env.GITHUB_REPOSITORY.split("/")[0];
const repo = process.env.GITHUB_REPOSITORY.split("/")[1];
const today = process.env.TODAY;

async function main() {
  let page = 1, per_page = 50, userCounts = {};
  // Get PRs updated today
  while (true) {
    const { data: prs } = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls',
      { owner, repo, state: 'all', per_page, page }
    );
    if (prs.length === 0) break;
    for (const pr of prs) {
      // For each PR, get reviews
      const { data: reviews } = await octokit.request(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
        { owner, repo, pull_number: pr.number }
      );
      for (const review of reviews) {
        if (review.submitted_at && review.submitted_at.startsWith(today)) {
          const user = review.user.login;
          userCounts[user] = (userCounts[user] || 0) + 1;
        }
      }
    }
    page++;
  }
  console.log("Today's PR Review Count:", userCounts);
}

main();
