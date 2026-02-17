# CloudFront + S3 Setup

One-time manual setup for the production CloudFront distribution.

> **Note**: This file uses placeholders (`<ACCOUNT_ID>`, `<DISTRIBUTION_ID>`, `<OAC_ID>`, `<RESPONSE_HEADERS_POLICY_ID>`, `<SECURITY_GROUP_ID>`, `<CF_PREFIX_LIST_ID>`, `<CLOUDFRONT_DOMAIN>`) for sensitive AWS resource IDs. Substitute real values before running commands. Real values are stored in GitHub Secrets or can be retrieved via AWS CLI.

## Architecture

```
CloudFront (https://<CLOUDFRONT_DOMAIN>)
  |- /*           -> S3 bucket (static Vite build, via OAC)
  |- /prover/*    -> Prover EC2 (HTTP, port 80, prefix stripped)
  |- /tee/*       -> TEE EC2 (HTTP, port 4000, prefix stripped)
```

## Resources Created

| Resource | ID / Name |
|---|---|
| S3 bucket | `tee-rex-app-prod` (eu-west-2, private) |
| OAC | `tee-rex-app-oac` (`<OAC_ID>`) |
| Response headers policy | `tee-rex-coop-coep` (`<RESPONSE_HEADERS_POLICY_ID>`) |
| CloudFront function | `tee-rex-strip-prefix` (strips `/prover` or `/tee` prefix) |
| Distribution | `<DISTRIBUTION_ID>` (`<CLOUDFRONT_DOMAIN>`) |

## Key Decisions

- **No custom domain**: CloudFront default `*.cloudfront.net` domain with free HTTPS.
- **COOP/COEP headers**: Required for SharedArrayBuffer (multi-threaded WASM proving). Applied via response headers policy on all behaviors.
- **Origin timeout**: 120s (quota max without support ticket). Covers most proof generation (1-2 min). For proofs exceeding 120s, request a quota increase to 180s via AWS Support (`Response timeout per origin` quota in Service Quotas console).
- **SPA fallback**: 403/404 custom error responses return `/index.html` with status 200.
- **Cache strategy**: Assets use Vite content-hash filenames -> `CachingOptimized`. Backend behaviors use `CachingDisabled`.
- **Security group**: Single rule using CloudFront managed prefix list (`<CF_PREFIX_LIST_ID>`) for ports 80-4000 to stay within the 60-rule SG quota.
- **Path stripping**: CloudFront Function rewrites `/prover/prove` -> `/prove` and `/tee/attestation` -> `/attestation` at viewer-request stage.

## One-Time Setup Commands

These were run once to create the infrastructure. Stored here for reference / reproducibility.

### 1. S3 Bucket

```bash
aws s3api create-bucket --bucket tee-rex-app-prod --region eu-west-2 \
  --create-bucket-configuration LocationConstraint=eu-west-2

aws s3api put-public-access-block --bucket tee-rex-app-prod \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

### 2. Security Group (CloudFront ingress)

```bash
CF_PREFIX=$(aws ec2 describe-managed-prefix-lists \
  --filters "Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing" \
  --query 'PrefixLists[0].PrefixListId' --output text --region eu-west-2)

aws ec2 authorize-security-group-ingress --group-id <SECURITY_GROUP_ID> \
  --ip-permissions "IpProtocol=tcp,FromPort=80,ToPort=4000,PrefixListIds=[{PrefixListId=${CF_PREFIX},Description=CloudFront (prover 80 + TEE 4000)}]" \
  --region eu-west-2
```

### 3. OAC + Response Headers Policy + CF Function

```bash
# OAC
aws cloudfront create-origin-access-control --origin-access-control-config \
  '{"Name":"tee-rex-app-oac","SigningProtocol":"sigv4","SigningBehavior":"always","OriginAccessControlOriginType":"s3"}'

# Response headers (COOP/COEP)
aws cloudfront create-response-headers-policy --response-headers-policy-config '{
  "Name":"tee-rex-coop-coep",
  "CustomHeadersConfig":{"Quantity":2,"Items":[
    {"Header":"Cross-Origin-Opener-Policy","Value":"same-origin","Override":true},
    {"Header":"Cross-Origin-Embedder-Policy","Value":"credentialless","Override":true}
  ]}
}'

# CF Function (strip /prover or /tee prefix)
FUNC_CODE=$(echo -n "function handler(event) { var request = event.request; request.uri = request.uri.replace(/^\/(prover|tee)/, '') || '/'; return request; }" | base64)
aws cloudfront create-function \
  --name tee-rex-strip-prefix \
  --function-config '{"Comment":"Strip /prover or /tee prefix from URI","Runtime":"cloudfront-js-2.0"}' \
  --function-code "$FUNC_CODE"
aws cloudfront publish-function --name tee-rex-strip-prefix --if-match <ETAG>
```

### 4. Distribution

Substitute placeholders in `distribution.json` before creating:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
sed -e "s/<ACCOUNT_ID>/$ACCOUNT_ID/g" \
    -e "s/<PROVER_EC2_DNS>/$PROVER_EC2_DNS/g" \
    -e "s/<TEE_EC2_DNS>/$TEE_EC2_DNS/g" \
    -e "s/<OAC_ID>/$OAC_ID/g" \
    -e "s/<RESPONSE_HEADERS_POLICY_ID>/$RESPONSE_HEADERS_POLICY_ID/g" \
  infra/cloudfront/distribution.json > /tmp/distribution.json
aws cloudfront create-distribution \
  --distribution-config file:///tmp/distribution.json
```

### 5. S3 Bucket Policy

```bash
aws s3api put-bucket-policy --bucket tee-rex-app-prod --policy '{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontOAC",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::tee-rex-app-prod/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>"
      }
    }
  }]
}'
```

## GitHub Secrets

| Secret | Value |
|---|---|
| `PROD_S3_BUCKET` | `tee-rex-app-prod` |
| `PROD_CLOUDFRONT_DISTRIBUTION_ID` | `<DISTRIBUTION_ID>` |
| `PROD_CLOUDFRONT_URL` | `https://<CLOUDFRONT_DOMAIN>` |
