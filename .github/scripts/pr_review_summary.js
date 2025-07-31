const { Octokit } = require('@octokit/core')
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

const owner = process.env.GITHUB_REPOSITORY.split('/')[0]
const repo = process.env.GITHUB_REPOSITORY.split('/')[1]
const today = process.env.TODAY // expect format YYYY-MM-DD

// Helper to fetch all pages of a paginated endpoint
async function fetchAllPages(method, params) {
  let results = []
  let page = 1
  while (true) {
    const response = await octokit.request(method, { ...params, per_page: 50, page })
    const data = response.data
    results = results.concat(data)
    if (data.length < 50) break // no more pages
    page++
  }
  return results
}

async function main() {
  try {
    const prs = await fetchAllPages('GET /repos/{owner}/{repo}/pulls', {
      owner,
      repo,
      state: 'all',
    })

    // Count PRs merged today
    const mergedTodayCount = prs.filter(
      (pr) => pr.merged_at && pr.merged_at.startsWith(today)
    ).length

    // Fetch reviews in parallel for all PRs, with pagination
    const allReviewsPerPR = await Promise.all(
      prs.map(async (pr) => {
        let reviews = []
        let page = 1
        while (true) {
          const response = await octokit.request(
            'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
            {
              owner,
              repo,
              pull_number: pr.number,
              per_page: 50,
              page,
            }
          )
          reviews = reviews.concat(response.data)
          if (response.data.length < 50) break
          page++
        }
        return reviews
      })
    )

    // Fetch review comments in parallel for all PRs, with pagination
    const allReviewCommentsPerPR = await Promise.all(
      prs.map(async (pr) => {
        let comments = []
        let page = 1
        while (true) {
          const response = await octokit.request(
            'GET /repos/{owner}/{repo}/pulls/{pull_number}/comments',
            {
              owner,
              repo,
              pull_number: pr.number,
              per_page: 50,
              page,
            }
          )
          comments = comments.concat(response.data)
          if (response.data.length < 50) break
          page++
        }
        return comments
      })
    )

    const userCounts = {}
    const userCommentCounts = {}

    // Flatten all reviews arrays
    const allReviews = allReviewsPerPR.flat()

    // Count reviews submitted today per user
    for (const review of allReviews) {
      if (review.submitted_at && review.submitted_at.startsWith(today)) {
        const user = review.user.login
        userCounts[user] = (userCounts[user] || 0) + 1
      }
    }

    // Flatten review comments and count per user (submitted today)
    const allComments = allReviewCommentsPerPR.flat()
    for (const comment of allComments) {
      if (comment.created_at && comment.created_at.startsWith(today)) {
        const user = comment.user.login
        userCommentCounts[user] = (userCommentCounts[user] || 0) + 1
      }
    }

    console.log("Today's PR Review Count per user:", userCounts)
    console.log("Today's Review Comment Count per user:", userCommentCounts)
    console.log(`Today's total merged PRs: ${mergedTodayCount}`)
  } catch (error) {
    console.error('Error fetching PR data:', error)
  }
}

main()
