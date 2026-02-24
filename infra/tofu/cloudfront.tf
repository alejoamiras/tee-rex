# -----------------------------------------------------------------------------
# Shared Resources (OAC, Response Headers Policy, CF Function)
# -----------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "app" {
  name                              = "tee-rex-app-oac"
  description                       = ""
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_response_headers_policy" "coop_coep" {
  name = "tee-rex-coop-coep"

  custom_headers_config {
    items {
      header   = "Cross-Origin-Opener-Policy"
      value    = "same-origin"
      override = true
    }
    items {
      header   = "Cross-Origin-Embedder-Policy"
      value    = "credentialless"
      override = true
    }
  }
}

resource "aws_cloudfront_function" "strip_prefix" {
  name    = "tee-rex-strip-prefix"
  runtime = "cloudfront-js-2.0"
  comment = "Strip /prover, /tee, or /sgx prefix from URI"
  publish = true

  code = "function handler(event) { var request = event.request; request.uri = request.uri.replace(/^\\/(prover|tee|sgx)/, '') || '/'; return request; }"
}

# -----------------------------------------------------------------------------
# Production Distribution
# -----------------------------------------------------------------------------

resource "aws_cloudfront_distribution" "prod" {
  comment             = "tee-rex production — app (S3) + prover/TEE (EC2) + SGX (Azure)"
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  http_version        = "http2"
  price_class         = "PriceClass_100"
  aliases             = var.prod_cloudfront_aliases

  # S3 origin (static app)
  origin {
    domain_name              = aws_s3_bucket.prod.bucket_regional_domain_name
    origin_id                = "s3-app"
    origin_access_control_id = aws_cloudfront_origin_access_control.app.id
  }

  # Prover EC2 origin (HTTP, port 80)
  origin {
    domain_name = aws_eip.prod_prover.public_dns
    origin_id   = "prover-ec2"

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1", "TLSv1.1", "TLSv1.2"]
      origin_read_timeout      = 120
      origin_keepalive_timeout = 5
    }
  }

  # TEE EC2 origin (HTTP, port 4000)
  origin {
    domain_name = aws_eip.prod_tee.public_dns
    origin_id   = "tee-ec2"

    custom_origin_config {
      http_port                = 4000
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1", "TLSv1.1", "TLSv1.2"]
      origin_read_timeout      = 120
      origin_keepalive_timeout = 5
    }
  }

  # SGX Azure origin (HTTP, port 4000)
  origin {
    domain_name = var.sgx_prod_public_ip
    origin_id   = "sgx-azure"

    custom_origin_config {
      http_port                = 4000
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1", "TLSv1.1", "TLSv1.2"]
      origin_read_timeout      = 120
      origin_keepalive_timeout = 5
    }
  }

  # Default behavior: S3 static app
  default_cache_behavior {
    target_origin_id           = "s3-app"
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.coop_coep.id
    compress                   = true
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
  }

  # /prover/* -> Prover EC2
  ordered_cache_behavior {
    path_pattern               = "/prover/*"
    target_origin_id           = "prover-ec2"
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.coop_coep.id
    compress                   = true
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods             = ["GET", "HEAD"]

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.strip_prefix.arn
    }
  }

  # /tee/* -> TEE EC2
  ordered_cache_behavior {
    path_pattern               = "/tee/*"
    target_origin_id           = "tee-ec2"
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.coop_coep.id
    compress                   = true
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods             = ["GET", "HEAD"]

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.strip_prefix.arn
    }
  }

  # /sgx/* -> SGX Azure VM
  ordered_cache_behavior {
    path_pattern               = "/sgx/*"
    target_origin_id           = "sgx-azure"
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.coop_coep.id
    compress                   = true
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods             = ["GET", "HEAD"]

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.strip_prefix.arn
    }
  }

  # SPA fallback: 403/404 → /index.html
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# -----------------------------------------------------------------------------
# Devnet Distribution (same pattern, different origins)
# -----------------------------------------------------------------------------

resource "aws_cloudfront_distribution" "devnet" {
  comment             = "tee-rex devnet — app (S3) + prover/TEE/SGX (EC2/Azure)"
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  http_version        = "http2"
  price_class         = "PriceClass_100"
  aliases             = var.devnet_cloudfront_aliases

  # S3 origin (static app)
  origin {
    domain_name              = aws_s3_bucket.devnet.bucket_regional_domain_name
    origin_id                = "s3-app"
    origin_access_control_id = aws_cloudfront_origin_access_control.app.id
  }

  # Prover EC2 origin (HTTP, port 80)
  origin {
    domain_name = aws_eip.devnet_prover.public_dns
    origin_id   = "prover-ec2"

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1", "TLSv1.1", "TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
  }

  # TEE EC2 origin (HTTP, port 4000)
  origin {
    domain_name = aws_eip.devnet_tee.public_dns
    origin_id   = "tee-ec2"

    custom_origin_config {
      http_port                = 4000
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1", "TLSv1.1", "TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
  }

  # SGX Azure origin (HTTP, port 4000) — shares prod IP for now
  origin {
    domain_name = var.sgx_prod_public_ip
    origin_id   = "sgx-azure"

    custom_origin_config {
      http_port                = 4000
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1", "TLSv1.1", "TLSv1.2"]
      origin_read_timeout      = 120
      origin_keepalive_timeout = 5
    }
  }

  # Default behavior: S3 static app
  default_cache_behavior {
    target_origin_id           = "s3-app"
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.coop_coep.id
    compress                   = true
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
  }

  # /prover/* -> Prover EC2
  ordered_cache_behavior {
    path_pattern               = "/prover/*"
    target_origin_id           = "prover-ec2"
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.coop_coep.id
    compress                   = true
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods             = ["GET", "HEAD"]

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.strip_prefix.arn
    }
  }

  # /tee/* -> TEE EC2
  ordered_cache_behavior {
    path_pattern               = "/tee/*"
    target_origin_id           = "tee-ec2"
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.coop_coep.id
    compress                   = true
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods             = ["GET", "HEAD"]

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.strip_prefix.arn
    }
  }

  # /sgx/* -> SGX Azure VM
  ordered_cache_behavior {
    path_pattern               = "/sgx/*"
    target_origin_id           = "sgx-azure"
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.coop_coep.id
    compress                   = true
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods             = ["GET", "HEAD"]

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.strip_prefix.arn
    }
  }

  # SPA fallback: 403/404 → /index.html
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}
