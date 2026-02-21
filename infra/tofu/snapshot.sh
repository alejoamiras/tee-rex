#!/usr/bin/env bash
# snapshot.sh — Capture complete AWS infrastructure state as a safety net.
# Output goes to .snapshot/ (gitignored). Contains sensitive IDs — never commit.
#
# Usage: ./snapshot.sh
# Prerequisites: aws CLI configured with appropriate permissions

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNAPSHOT_DIR="${SCRIPT_DIR}/.snapshot"
REGION="eu-west-2"

mkdir -p "$SNAPSHOT_DIR"

echo "Capturing AWS infrastructure snapshot to ${SNAPSHOT_DIR}..."

# EC2 instances (all tee-rex instances by tag)
echo "  EC2 instances..."
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=tee-rex-*" \
  --region "$REGION" \
  --output json > "${SNAPSHOT_DIR}/ec2-instances.json"

# Elastic IPs
echo "  Elastic IPs..."
aws ec2 describe-addresses \
  --filters "Name=tag:Name,Values=tee-rex-*" \
  --region "$REGION" \
  --output json > "${SNAPSHOT_DIR}/elastic-ips.json"

# Security groups
echo "  Security groups..."
aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=tee-rex-sg" \
  --region "$REGION" \
  --output json > "${SNAPSHOT_DIR}/security-groups.json"

# Security group rules
echo "  Security group rules..."
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=tee-rex-sg" \
  --query 'SecurityGroups[0].GroupId' --output text --region "$REGION")
aws ec2 describe-security-group-rules \
  --filters "Name=group-id,Values=${SG_ID}" \
  --region "$REGION" \
  --output json > "${SNAPSHOT_DIR}/security-group-rules.json"

# IAM roles
echo "  IAM roles..."
for role in tee-rex-ci-github tee-rex-ec2-role; do
  aws iam get-role --role-name "$role" --output json > "${SNAPSHOT_DIR}/iam-role-${role}.json" 2>/dev/null || true
done

# IAM policy
echo "  IAM policies..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws iam get-policy \
  --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/tee-rex-ci-policy" \
  --output json > "${SNAPSHOT_DIR}/iam-policy.json" 2>/dev/null || true

# IAM policy document (latest version)
POLICY_VERSION=$(aws iam get-policy \
  --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/tee-rex-ci-policy" \
  --query 'Policy.DefaultVersionId' --output text 2>/dev/null || echo "v1")
aws iam get-policy-version \
  --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/tee-rex-ci-policy" \
  --version-id "$POLICY_VERSION" \
  --output json > "${SNAPSHOT_DIR}/iam-policy-document.json" 2>/dev/null || true

# IAM instance profile
echo "  IAM instance profile..."
aws iam get-instance-profile \
  --instance-profile-name tee-rex-ec2-profile \
  --output json > "${SNAPSHOT_DIR}/iam-instance-profile.json" 2>/dev/null || true

# IAM role policy attachments
for role in tee-rex-ci-github tee-rex-ec2-role; do
  aws iam list-attached-role-policies --role-name "$role" \
    --output json > "${SNAPSHOT_DIR}/iam-role-policies-${role}.json" 2>/dev/null || true
done

# OIDC provider
echo "  OIDC provider..."
aws iam list-open-id-connect-providers \
  --output json > "${SNAPSHOT_DIR}/oidc-providers.json"

# ECR
echo "  ECR repository..."
aws ecr describe-repositories \
  --repository-names tee-rex \
  --region "$REGION" \
  --output json > "${SNAPSHOT_DIR}/ecr.json" 2>/dev/null || true

# S3 buckets
echo "  S3 buckets..."
for bucket in tee-rex-app-prod tee-rex-app-devnet; do
  aws s3api get-bucket-policy --bucket "$bucket" \
    --output json > "${SNAPSHOT_DIR}/s3-policy-${bucket}.json" 2>/dev/null || true
  aws s3api get-public-access-block --bucket "$bucket" \
    --output json > "${SNAPSHOT_DIR}/s3-public-access-${bucket}.json" 2>/dev/null || true
done

# CloudFront distributions
echo "  CloudFront distributions..."
aws cloudfront list-distributions \
  --output json > "${SNAPSHOT_DIR}/cloudfront-distributions.json"

# CloudFront OAC
echo "  CloudFront OAC..."
aws cloudfront list-origin-access-controls \
  --output json > "${SNAPSHOT_DIR}/cloudfront-oac.json"

# CloudFront functions
echo "  CloudFront functions..."
aws cloudfront list-functions \
  --output json > "${SNAPSHOT_DIR}/cloudfront-functions.json"

# CloudFront response headers policies
echo "  CloudFront response headers policies..."
aws cloudfront list-response-headers-policies --type custom \
  --output json > "${SNAPSHOT_DIR}/cloudfront-headers-policies.json"

# ACM certificate (us-east-1)
echo "  ACM certificate..."
aws acm list-certificates \
  --region us-east-1 \
  --output json > "${SNAPSHOT_DIR}/acm-certs.json"

# VPC and subnets
echo "  VPC and subnets..."
aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" \
  --region "$REGION" \
  --output json > "${SNAPSHOT_DIR}/vpc.json"
aws ec2 describe-subnets --filters "Name=defaultForAz,Values=true" \
  --region "$REGION" \
  --output json > "${SNAPSHOT_DIR}/subnets.json"

# Key pair
echo "  Key pair..."
aws ec2 describe-key-pairs --key-names tee-rex-key \
  --region "$REGION" \
  --output json > "${SNAPSHOT_DIR}/key-pair.json" 2>/dev/null || true

echo ""
echo "Snapshot complete! Files saved to ${SNAPSHOT_DIR}/"
echo "This directory is gitignored — it contains sensitive AWS resource IDs."
