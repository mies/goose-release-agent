#!/bin/bash

# Load the actual webhook secret from .dev.vars if it exists
if [ -f .dev.vars ]; then
  # Extract GITHUB_WEBHOOK_SECRET from .dev.vars
  WEBHOOK_SECRET=$(grep GITHUB_WEBHOOK_SECRET .dev.vars | cut -d= -f2 | tr -d '"' | tr -d "'" || echo "")
  if [ -n "$WEBHOOK_SECRET" ]; then
    echo "ℹ️  Found webhook secret in .dev.vars"
    SECRET=$WEBHOOK_SECRET
  else
    # If no secret found in .dev.vars, use command line arg or default
    SECRET=${1:-"test_webhook_secret"}
    echo "⚠️  No webhook secret found in .dev.vars, using provided secret or default"
  fi
else
  # If .dev.vars doesn't exist, use command line arg or default
  SECRET=${1:-"test_webhook_secret"}
  echo "⚠️  .dev.vars file not found, using provided secret or default"
fi

EVENT=${2:-"release"}
WEBHOOK_URL="http://localhost:8787/webhooks/github?test_mode=true"

# Current timestamp in ISO 8601 format
CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Event-specific payload
if [ "$EVENT" = "release" ]; then
  PAYLOAD='{
    "action": "published",
    "release": {
      "id": 12345,
      "tag_name": "v1.0.0",
      "name": "Release 1.0.0",
      "body": "Initial release",
      "created_at": "'$CURRENT_TIME'",
      "published_at": "'$CURRENT_TIME'",
      "draft": false,
      "prerelease": false,
      "html_url": "https://github.com/owner/repo/releases/tag/v1.0.0"
    },
    "repository": {
      "id": 54321,
      "full_name": "owner/repo",
      "name": "repo",
      "owner": {
        "login": "owner"
      },
      "default_branch": "main"
    }
  }'
elif [ "$EVENT" = "pull_request" ]; then
  PAYLOAD='{
    "action": "closed",
    "pull_request": {
      "id": 12345,
      "number": 42,
      "title": "Add new feature",
      "body": "This PR adds a cool new feature",
      "user": {"login": "developer"},
      "html_url": "https://github.com/owner/repo/pull/42",
      "merged_at": "'$CURRENT_TIME'",
      "labels": [{"name": "feature"}],
      "head": {"sha": "abc123"},
      "base": {"sha": "def456"}
    },
    "repository": {
      "id": 54321,
      "full_name": "owner/repo",
      "name": "repo",
      "owner": {"login": "owner"},
      "default_branch": "main"
    }
  }'
elif [ "$EVENT" = "push" ]; then
  PAYLOAD='{
    "ref": "refs/heads/main",
    "repository": {
      "id": 54321,
      "full_name": "owner/repo",
      "name": "repo",
      "owner": {"login": "owner"},
      "default_branch": "main"
    },
    "commits": [
      {
        "id": "commit1",
        "message": "Fix bug in login system",
        "author": {"name": "Developer Name", "email": "dev@example.com"},
        "timestamp": "'$CURRENT_TIME'",
        "url": "https://github.com/owner/repo/commit/commit1"
      }
    ],
    "head_commit": {
      "id": "head1",
      "message": "Merge pull request #42",
      "author": {"name": "Developer Name", "email": "dev@example.com"},
      "timestamp": "'$CURRENT_TIME'",
      "url": "https://github.com/owner/repo/commit/head1"
    }
  }'
else
  echo "Unknown event type: $EVENT"
  echo "Supported events: release, pull_request, push"
  exit 1
fi

# Calculate signature
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

# Display info
echo "📣 Testing GitHub webhook"
echo "⚙️  Event type: $EVENT"
echo "🔑 Using secret: $SECRET"
echo "🔗 Webhook URL: $WEBHOOK_URL"
echo "🔒 Signature: sha256=$SIGNATURE"

# Send the request
echo -e "\n📤 Sending webhook..."
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: $EVENT" \
  -H "X-GitHub-Delivery: test-$(date +%s)" \
  -H "X-Hub-Signature-256: sha256=$SIGNATURE" \
  -d "$PAYLOAD"

echo -e "\n\n✅ Done!" 