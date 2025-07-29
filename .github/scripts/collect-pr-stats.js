const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');

// Initialize Octokit with GitHub token
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

async function collectPRReviewStats() {
  try {
    console.log(`Collecting PR review stats for ${REPO_OWNER}/${REPO_NAME}`);
    
    // Get all closed/merged PRs from the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data: pullRequests } = await octokit.rest.pulls.list({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: 100,
    });
    
    // Filter PRs from last 30 days
    const recentPRs = pullRequests.filter(pr => 
      new Date(pr.updated_at) > thirtyDaysAgo
    );
    
    console.log(`Found ${recentPRs.length} PRs from the last 30 days`);
    
    // Track reviewer statistics
    const reviewerStats = new Map();
    const prReviewCounts = new Map();
    
    // Process each PR to get review data
    for (const pr of recentPRs) {
      console.log(`Processing PR #${pr.number}: ${pr.title}`);
      
      try {
        // Get reviews for this PR
        const { data: reviews } = await octokit.rest.pulls.listReviews({
          owner: REPO_OWNER,
          repo: REPO_NAME,
          pull_number: pr.number,
        });
        
        // Track unique reviewers for this PR
        const prReviewers = new Set();
        
        reviews.forEach(review => {
          if (review.user && review.user.login && review.state !== 'PENDING') {
            const reviewer = review.user.login;
            prReviewers.add(reviewer);
            
            // Update reviewer stats
            if (!reviewerStats.has(reviewer)) {
              reviewerStats.set(reviewer, {
                name: review.user.login,
                displayName: review.user.name || review.user.login,
                totalReviews: 0,
                prsReviewed: new Set(),
              });
            }
            
            const stats = reviewerStats.get(reviewer);
            stats.totalReviews++;
            stats.prsReviewed.add(pr.number);
          }
        });
        
        // Count how many people reviewed this PR
        prReviewCounts.set(pr.number, {
          title: pr.title,
          url: pr.html_url,
          reviewerCount: prReviewers.size,
          reviewers: Array.from(prReviewers),
          createdAt: pr.created_at,
          mergedAt: pr.merged_at,
        });
        
      } catch (error) {
        console.error(`Error processing PR #${pr.number}:`, error.message);
      }
    }
    
    // Prepare statistics summary
    const summary = {
      generatedAt: new Date().toISOString(),
      repository: `${REPO_OWNER}/${REPO_NAME}`,
      periodDays: 30,
      totalPRs: recentPRs.length,
      totalReviewers: reviewerStats.size,
      reviewerStatistics: Array.from(reviewerStats.entries()).map(([login, stats]) => ({
        reviewerLogin: login,
        displayName: stats.displayName,
        totalReviews: stats.totalReviews,
        uniquePRsReviewed: stats.prsReviewed.size,
      })).sort((a, b) => b.totalReviews - a.totalReviews), // Sort by review count descending
      prStatistics: Array.from(prReviewCounts.entries()).map(([prNumber, data]) => ({
        prNumber: parseInt(prNumber),
        title: data.title,
        url: data.url,
        reviewerCount: data.reviewerCount,
        reviewers: data.reviewers,
        createdAt: data.createdAt,
        mergedAt: data.mergedAt,
      })).sort((a, b) => b.reviewerCount - a.reviewerCount), // Sort by reviewer count descending
    };
    
    // Create output directory
    const outputDir = path.join(process.cwd(), 'pr-review-stats');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Save detailed JSON report
    const jsonFile = path.join(outputDir, `pr-review-stats-${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify(summary, null, 2));
    
    // Create a readable summary report
    let readableReport = `# PR Review Statistics Report\n\n`;
    readableReport += `**Generated:** ${summary.generatedAt}\n`;
    readableReport += `**Repository:** ${summary.repository}\n`;
    readableReport += `**Period:** Last ${summary.periodDays} days\n`;
    readableReport += `**Total PRs:** ${summary.totalPRs}\n`;
    readableReport += `**Total Reviewers:** ${summary.totalReviewers}\n\n`;
    
    readableReport += `## Top Reviewers by Review Count\n\n`;
    readableReport += `| Reviewer | Display Name | Total Reviews | Unique PRs Reviewed |\n`;
    readableReport += `|----------|--------------|---------------|--------------------|\n`;
    
    summary.reviewerStatistics.forEach(reviewer => {
      readableReport += `| ${reviewer.reviewerLogin} | ${reviewer.displayName} | ${reviewer.totalReviews} | ${reviewer.uniquePRsReviewed} |\n`;
    });
    
    readableReport += `\n## PRs by Review Count\n\n`;
    readableReport += `| PR # | Title | Reviewers Count | Reviewers |\n`;
    readableReport += `|------|-------|----------------|----------|\n`;
    
    summary.prStatistics.slice(0, 20).forEach(pr => { // Show top 20 PRs
      const reviewersList = pr.reviewers.join(', ');
      const truncatedTitle = pr.title.length > 50 ? pr.title.substring(0, 47) + '...' : pr.title;
      readableReport += `| [#${pr.prNumber}](${pr.url}) | ${truncatedTitle} | ${pr.reviewerCount} | ${reviewersList} |\n`;
    });
    
    // Save readable report
    const markdownFile = path.join(outputDir, `pr-review-summary-${new Date().toISOString().split('T')[0]}.md`);
    fs.writeFileSync(markdownFile, readableReport);
    
    // Save latest summary (overwrite each time)
    const latestFile = path.join(outputDir, 'latest-pr-review-stats.json');
    fs.writeFileSync(latestFile, JSON.stringify(summary, null, 2));
    
    console.log('\n=== PR Review Statistics Summary ===');
    console.log(`Total PRs analyzed: ${summary.totalPRs}`);
    console.log(`Total reviewers: ${summary.totalReviewers}`);
    console.log('\nTop 5 Reviewers:');
    summary.reviewerStatistics.slice(0, 5).forEach((reviewer, index) => {
      console.log(`${index + 1}. ${reviewer.displayName} (${reviewer.reviewerLogin}): ${reviewer.totalReviews} reviews on ${reviewer.uniquePRsReviewed} PRs`);
    });
    
    console.log(`\nReports saved to:`);
    console.log(`- ${jsonFile}`);
    console.log(`- ${markdownFile}`);
    console.log(`- ${latestFile}`);
    
  } catch (error) {
    console.error('Error collecting PR review stats:', error);
    process.exit(1);
  }
}

// Run the script
collectPRReviewStats();
