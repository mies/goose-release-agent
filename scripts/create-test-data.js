#!/usr/bin/env node

// Script to create test data for changelog generation
const { execSync } = require('child_process');

// Configuration - customize as needed
const DB_PATH = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite';
const RELEASE_ID = process.argv[2]; // Pass release ID as first argument
const REPO = 'owner/test-repo';

if (!RELEASE_ID) {
  console.error('Please provide a release ID as the first argument');
  console.error('Example: node scripts/create-test-data.js 123');
  process.exit(1);
}

// Find the D1 database file
let dbPath;
try {
  dbPath = execSync(`ls ${DB_PATH}`).toString().trim();
  console.log(`Found database at: ${dbPath}`);
} catch (error) {
  console.error('Failed to find the D1 database file.');
  console.error('Make sure you have run the app at least once with "pnpm run dev"');
  process.exit(1);
}

// Sample PRs with different categories
const pullRequests = [
  // Features
  {
    prNumber: 101,
    title: 'Add user authentication with OAuth',
    author: 'dev1',
    description: 'This PR implements user authentication using OAuth providers like Google and GitHub',
    url: 'https://github.com/owner/test-repo/pull/101',
    mergedAt: new Date().toISOString(),
    labels: JSON.stringify(['feature', 'security']),
    categoryId: 1 // Features
  },
  {
    prNumber: 102,
    title: 'Implement dark mode support',
    author: 'dev2',
    description: 'Adds system-wide dark mode with automatic detection of user preferences',
    url: 'https://github.com/owner/test-repo/pull/102',
    mergedAt: new Date().toISOString(),
    labels: JSON.stringify(['feature', 'ui']),
    categoryId: 1 // Features
  },
  
  // Bug Fixes
  {
    prNumber: 103,
    title: 'Fix memory leak in real-time updates',
    author: 'dev3',
    description: 'Resolves a critical memory leak that occurred when websockets were disconnected improperly',
    url: 'https://github.com/owner/test-repo/pull/103',
    mergedAt: new Date().toISOString(),
    labels: JSON.stringify(['bug', 'critical']),
    categoryId: 2 // Bug Fixes
  },
  {
    prNumber: 104,
    title: 'Fix incorrect timestamp display in activity log',
    author: 'dev1',
    description: 'Timestamps were being displayed in server timezone instead of user timezone',
    url: 'https://github.com/owner/test-repo/pull/104',
    mergedAt: new Date().toISOString(),
    labels: JSON.stringify(['bug']),
    categoryId: 2 // Bug Fixes
  },
  
  // Documentation
  {
    prNumber: 105,
    title: 'Update API documentation',
    author: 'dev4',
    description: 'Updates API docs with new endpoints and better examples',
    url: 'https://github.com/owner/test-repo/pull/105',
    mergedAt: new Date().toISOString(),
    labels: JSON.stringify(['documentation']),
    categoryId: 3 // Documentation
  },
  
  // Other Changes
  {
    prNumber: 106,
    title: 'Refactor database connection handling',
    author: 'dev2',
    description: 'Improves connection pooling and error handling for database operations',
    url: 'https://github.com/owner/test-repo/pull/106',
    mergedAt: new Date().toISOString(),
    labels: JSON.stringify(['refactor']),
    categoryId: 4 // Other Changes
  }
];

// Sample commits
const commits = [
  {
    hash: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
    message: 'Add user authentication with OAuth',
    author: 'dev1',
    authorEmail: 'dev1@example.com',
    date: new Date().toISOString(),
    pullRequestId: 1 // Will be updated with actual PR ID
  },
  {
    hash: 'b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1',
    message: 'Fix test cases for OAuth integration',
    author: 'dev1',
    authorEmail: 'dev1@example.com',
    date: new Date().toISOString(),
    pullRequestId: 1 // Will be updated with actual PR ID
  },
  {
    hash: 'c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2',
    message: 'Implement dark mode support',
    author: 'dev2',
    authorEmail: 'dev2@example.com',
    date: new Date().toISOString(),
    pullRequestId: 2 // Will be updated with actual PR ID
  },
  {
    hash: 'd4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3',
    message: 'Add user preference for dark mode',
    author: 'dev2',
    authorEmail: 'dev2@example.com',
    date: new Date().toISOString(),
    pullRequestId: 2 // Will be updated with actual PR ID
  },
  {
    hash: 'e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4',
    message: 'Fix memory leak in real-time updates',
    author: 'dev3',
    authorEmail: 'dev3@example.com',
    date: new Date().toISOString(),
    pullRequestId: 3 // Will be updated with actual PR ID
  },
  {
    hash: 'f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5',
    message: 'Fix incorrect timestamp display in activity log',
    author: 'dev1',
    authorEmail: 'dev1@example.com',
    date: new Date().toISOString(),
    pullRequestId: 4 // Will be updated with actual PR ID
  }
];

// Insert categories if they don't exist
const ensureCategories = `
sqlite3 ${dbPath} << 'EOF'
INSERT OR IGNORE INTO categories (id, name, description, display_order, created_at, updated_at) 
VALUES 
(1, 'Features', 'New features and enhancements', 10, datetime('now'), datetime('now')),
(2, 'Bug Fixes', 'Bug fixes and issue resolutions', 20, datetime('now'), datetime('now')),
(3, 'Documentation', 'Documentation updates', 30, datetime('now'), datetime('now')),
(4, 'Other Changes', 'Other changes and improvements', 40, datetime('now'), datetime('now'));
EOF`;

console.log('Ensuring categories exist...');
try {
  execSync(ensureCategories, { stdio: 'inherit' });
} catch (error) {
  console.error('Failed to insert categories:', error);
  process.exit(1);
}

// Insert pull requests
console.log('Inserting pull requests...');
pullRequests.forEach((pr, index) => {
  const prId = index + 1;
  const insertPR = `
  sqlite3 ${dbPath} << 'EOF'
  INSERT OR IGNORE INTO pull_requests (
    id, pr_number, release_id, title, author, description, url, merged_at, labels, category_id, created_at, updated_at
  ) VALUES (
    ${prId}, ${pr.prNumber}, ${RELEASE_ID}, '${pr.title.replace(/'/g, "''")}', 
    '${pr.author}', '${(pr.description || '').replace(/'/g, "''")}', 
    '${pr.url}', '${pr.mergedAt}', '${pr.labels}', 
    ${pr.categoryId}, datetime('now'), datetime('now')
  );
  EOF`;
  
  try {
    execSync(insertPR);
    console.log(`  Added PR #${pr.prNumber}: ${pr.title}`);
  } catch (error) {
    console.error(`Failed to insert PR #${pr.prNumber}:`, error);
  }
});

// Insert commits
console.log('Inserting commits...');
commits.forEach((commit, index) => {
  const insertCommit = `
  sqlite3 ${dbPath} << 'EOF'
  INSERT OR IGNORE INTO commits (
    id, hash, release_id, pull_request_id, message, author, author_email, date, created_at, updated_at
  ) VALUES (
    ${index + 1}, '${commit.hash}', ${RELEASE_ID}, 
    ${commit.pullRequestId}, '${commit.message.replace(/'/g, "''")}', 
    '${commit.author}', '${commit.authorEmail}', 
    '${commit.date}', datetime('now'), datetime('now')
  );
  EOF`;
  
  try {
    execSync(insertCommit);
    console.log(`  Added commit ${commit.hash.substring(0, 7)}: ${commit.message}`);
  } catch (error) {
    console.error(`Failed to insert commit ${commit.hash.substring(0, 7)}:`, error);
  }
});

console.log('\nTest data created successfully!');
console.log('\nYou can now generate a changelog with:');
console.log(`curl -X POST http://localhost:8787/releases/${RELEASE_ID}/changelog \\`);
console.log('  -H "Content-Type: application/json" \\');
console.log('  -d \'{ "format": "markdown", "style": "technical", "includeCommits": true }\''); 