const { Octokit } = require('@octokit/core')
// const xlsx = require('xlsx')
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

const owner = process.env.GITHUB_REPOSITORY.split('/')[0]
const repo = process.env.GITHUB_REPOSITORY.split('/')[1]
const today = process.env.TODAY // expect format YYYY-MM-DD

// const genrateExcel = (
//   userCounts,
//   userCommentCounts,
//   raisedTodayCountsPerUser,
//   mergedTodayCount
// ) => {
//   try {
//     // ... your existing code to fetch data

//     // After console logs, create Excel workbook and sheets

//     // Prepare data arrays for each sheet:
//     // For example, convert objects {user: count} to arrays like [{User, Count}, ...]

//     const reviewCountData = Object.entries(userCounts).map(([user, count]) => ({
//       User: user,
//       'PR Reviews (Approved/Changes Requested)': count,
//     }))

//     const commentCountData = Object.entries(userCommentCounts).map(
//       ([user, count]) => ({
//         User: user,
//         'Review Comments': count,
//       })
//     )

//     const raisedPRsPerUserData = Object.entries(raisedTodayCountsPerUser).map(
//       ([user, count]) => ({
//         User: user,
//         'PRs Raised': count,
//       })
//     )

//     // Create a new workbook
//     const workbook = xlsx.utils.book_new()

//     // Convert data arrays to worksheets
//     const wsReviewCounts = xlsx.utils.json_to_sheet(reviewCountData)
//     const wsCommentCounts = xlsx.utils.json_to_sheet(commentCountData)
//     const wsRaisedPRs = xlsx.utils.json_to_sheet(raisedPRsPerUserData)

//     // Append worksheets to the workbook with sheet names
//     xlsx.utils.book_append_sheet(workbook, wsReviewCounts, 'PR Review Counts')
//     xlsx.utils.book_append_sheet(workbook, wsCommentCounts, 'Review Comments')
//     xlsx.utils.book_append_sheet(workbook, wsRaisedPRs, 'PRs Raised')

//     // Add summary sheet with total merged PRs and total PRs raised
//     const summaryData = [
//       { Metric: 'Total PRs Merged Today', Count: mergedTodayCount },
//       {
//         Metric: 'Total PRs Raised Today',
//         Count: Object.values(raisedTodayCountsPerUser).reduce((a, b) => a + b, 0),
//       },
//     ]
//     const wsSummary = xlsx.utils.json_to_sheet(summaryData)
//     xlsx.utils.book_append_sheet(workbook, wsSummary, 'Summary')

//     // Write workbook to file
//     xlsx.writeFile(workbook, 'PRDataSummary.xlsx')

//     console.log('Excel file PRDataSummary.xlsx has been generated successfully.')
//   } catch (error) {
//     console.error('Error fetching PR data or generating Excel:', error)
//   }
// }

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

    // // Count reviews submitted today per user
    // for (const review of allReviews) {
    //   if (review.submitted_at && review.submitted_at.startsWith(today)) {
    //     const user = review.user.login
    //     userCounts[user] = (userCounts[user] || 0) + 1
    //   }
    // }
    // Count reviews submitted today per user with approved or changes requested states
    for (const review of allReviews) {
      if (
        review.submitted_at &&
        review.submitted_at.startsWith(today) &&
        (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED')
      ) {
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

    // Count PRs raised today per user
    const raisedTodayCountsPerUser = {}
    for (const pr of prs) {
      if (pr.created_at && pr.created_at.startsWith(today)) {
        const user = pr.user.login
        raisedTodayCountsPerUser[user] = (raisedTodayCountsPerUser[user] || 0) + 1
      }
    }

    // Collect all unique user names from all three objects
    const allUsers = new Set([
      ...Object.keys(userCounts),
      ...Object.keys(userCommentCounts),
      ...Object.keys(raisedTodayCountsPerUser),
    ])

    // Build the array of objects
    const mergedUserData = Array.from(allUsers).map((user) => ({
      name: user,
      preReviewCount: userCounts[user] || 0,
      addedComments: userCommentCounts[user] || 0,
      prRaised: raisedTodayCountsPerUser[user] || 0,
    }))

    const data = {
      userData: mergedUserData,
      mergedTodayCount: mergedTodayCount,
    }

    console.log(data)

    // console.log("Today's PR Review Count per user:", userCounts)
    // console.log("Today's Review Comment Count per user:", userCommentCounts)
    // console.log(`Today's total merged PRs: ${mergedTodayCount}`)
    // console.log("Today's PRs raised per user:", raisedTodayCountsPerUser)
    // genrateExcel(
    //   userCounts,
    //   userCommentCounts,
    //   raisedTodayCountsPerUser,
    //   mergedTodayCount
    // )
  } catch (error) {
    console.error('Error fetching PR data:', error)
  }
}

main()
