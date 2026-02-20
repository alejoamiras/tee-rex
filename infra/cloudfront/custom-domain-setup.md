# Custom Domain Setup (`tee-rex.dev`)

One-time manual setup for custom domains on CloudFront distributions. Domain registered on Cloudflare.

> **Placeholders**: `<CERT_ARN>`, `<ZONE_ID>`, `<PROD_DISTRIBUTION_ID>`, `<DEVNET_DISTRIBUTION_ID>`, `<PROD_CLOUDFRONT_DOMAIN>`, `<DEVNET_CLOUDFRONT_DOMAIN>`, `<ETAG>`. Substitute real values before running commands.

## Architecture

```
tee-rex.dev           -> 301 redirect to nextnet.tee-rex.dev (Cloudflare Redirect Rule)
nextnet.tee-rex.dev   -> CNAME -> <PROD_CLOUDFRONT_DOMAIN> (prod CF distribution)
devnet.tee-rex.dev    -> CNAME -> <DEVNET_CLOUDFRONT_DOMAIN> (devnet CF distribution)
```

## Prerequisites

- `CLOUDFLARE_API_TOKEN` env var with Zone:DNS:Edit permission for `tee-rex.dev`
- AWS CLI configured with access to ACM + CloudFront

## 1. Request ACM wildcard certificate (us-east-1)

CloudFront requires ACM certs in `us-east-1` regardless of where other resources live.

```bash
aws acm request-certificate \
  --domain-name "*.tee-rex.dev" \
  --subject-alternative-names "tee-rex.dev" \
  --validation-method DNS \
  --region us-east-1
```

Note the `CertificateArn` from the output.

## 2. DNS validation via Cloudflare

```bash
# Get the validation CNAME from ACM
aws acm describe-certificate --certificate-arn <CERT_ARN> --region us-east-1 \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'

# Get Cloudflare zone ID
ZONE_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=tee-rex.dev" | jq -r '.result[0].id')

# Create validation CNAME (DNS-only, no proxy)
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"<ACM_CNAME_NAME>","content":"<ACM_CNAME_VALUE>","proxied":false}'
```

Wait for validation (5-15 min):
```bash
aws acm describe-certificate --certificate-arn <CERT_ARN> --region us-east-1 \
  --query 'Certificate.Status'
# Should return "ISSUED"
```

## 3. Add alternate domain names to CloudFront distributions

### Prod (nextnet.tee-rex.dev)

```bash
aws cloudfront get-distribution-config --id <PROD_DISTRIBUTION_ID> > /tmp/prod-dist.json
# Extract ETag for update
ETAG=$(jq -r '.ETag' /tmp/prod-dist.json)

# Edit /tmp/prod-dist.json:
#   - Move .DistributionConfig to top level (remove wrapper)
#   - Set Aliases: { "Quantity": 1, "Items": ["nextnet.tee-rex.dev"] }
#   - Set ViewerCertificate:
#       "ACMCertificateArn": "<CERT_ARN>",
#       "SSLSupportMethod": "sni-only",
#       "MinimumProtocolVersion": "TLSv1.2_2021"
#   - Remove "CloudFrontDefaultCertificate": true

aws cloudfront update-distribution --id <PROD_DISTRIBUTION_ID> \
  --distribution-config file:///tmp/prod-dist-updated.json \
  --if-match "$ETAG"
```

### Devnet (devnet.tee-rex.dev)

Same process with `<DEVNET_DISTRIBUTION_ID>` and `"devnet.tee-rex.dev"` as the alias.

## 4. Create Cloudflare CNAME records

**Critical**: Use `proxied: false` (gray cloud / DNS-only). Cloudflare proxy rewrites the `Host` header, breaking CloudFront domain validation.

```bash
# nextnet.tee-rex.dev -> prod CloudFront
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"nextnet","content":"<PROD_CLOUDFRONT_DOMAIN>","proxied":false}'

# devnet.tee-rex.dev -> devnet CloudFront
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"devnet","content":"<DEVNET_CLOUDFRONT_DOMAIN>","proxied":false}'
```

## 5. Root domain redirect

Redirect `tee-rex.dev` to `nextnet.tee-rex.dev`. Requires a proxied DNS record (orange cloud) so Cloudflare's redirect rules can intercept traffic.

```bash
# Dummy A record for root domain (proxied)
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"A","name":"tee-rex.dev","content":"192.0.2.1","proxied":true}'

# Redirect rule (Cloudflare Dashboard > Rules > Redirect Rules, or via API)
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_dynamic_redirect/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rules": [{
      "expression": "(http.host eq \"tee-rex.dev\")",
      "description": "Redirect root to nextnet",
      "action": "redirect",
      "action_parameters": {
        "from_value": {
          "status_code": 301,
          "target_url": {
            "expression": "concat(\"https://nextnet.tee-rex.dev\", http.request.uri.path)"
          },
          "preserve_query_string": true
        }
      }
    }]
  }'
```

## 6. Update GitHub Secrets

| Secret | Old Value | New Value |
|---|---|---|
| `PROD_CLOUDFRONT_URL` | `https://<PROD_CLOUDFRONT_DOMAIN>` | `https://nextnet.tee-rex.dev` |
| `DEVNET_CLOUDFRONT_URL` | `https://<DEVNET_CLOUDFRONT_DOMAIN>` | `https://devnet.tee-rex.dev` |

Old CloudFront URLs continue to work (CloudFront serves both the default domain and alternate domain names).

## Security Notes

1. **Cloudflare API token scoping**: Use Zone:DNS:Edit for `tee-rex.dev` only. Consider revoking after setup if no ongoing programmatic DNS access is needed.
2. **DNS-only mode (gray cloud)**: Subdomain CNAMEs (`nextnet`, `devnet`) MUST use `proxied: false`. Orange cloud breaks CloudFront.
3. **Subdomain takeover**: If a CloudFront distribution is deleted, immediately remove its Cloudflare CNAME record.
4. **`.dev` HSTS preload**: All `.dev` domains enforce HTTPS-only via browser HSTS preload list. No HTTP downgrade attacks possible.
