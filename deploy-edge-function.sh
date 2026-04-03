#!/usr/bin/env bash
# Run this script once to deploy the Availity edge function to Supabase
# Prerequisites: supabase CLI installed (brew install supabase/tap/supabase)

set -e

PROJECT_REF="slkcjzqlupdoocxficug"

echo "🔐 Logging into Supabase..."
supabase login

echo "📦 Deploying availity-integration edge function..."
supabase functions deploy availity-integration \
  --project-ref "$PROJECT_REF" \
  --no-verify-jwt

echo "✅ Done! Edge function deployed with Availity credentials."
echo ""
echo "Test it:"
echo "  curl -X POST https://${PROJECT_REF}.supabase.co/functions/v1/availity-integration \\"
echo "    -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsa2NqenFsdXBkb29jeGZpY3VnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNDkyNzksImV4cCI6MjA5MDYyNTI3OX0.Yrklj2y3hxQNsM7d8kKs2Anh_Onhx623C8-BfIvxU50' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"action\":\"check_eligibility\",\"memberId\":\"TEST123\",\"firstName\":\"John\",\"lastName\":\"Doe\",\"dateOfBirth\":\"1990-01-01\",\"carrierCode\":\"60054\"}'"
