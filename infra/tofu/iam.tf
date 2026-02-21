# -----------------------------------------------------------------------------
# GitHub Actions OIDC Provider
# -----------------------------------------------------------------------------

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [var.github_oidc_thumbprint]
}

# -----------------------------------------------------------------------------
# CI Role (GitHub Actions → AWS via OIDC)
# -----------------------------------------------------------------------------

resource "aws_iam_role" "ci" {
  name = "tee-rex-ci-github"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = [
              "repo:alejoamiras/tee-rex:ref:refs/heads/main",
              "repo:alejoamiras/tee-rex:ref:refs/heads/devnet",
              "repo:alejoamiras/tee-rex:ref:refs/heads/chore/aztec-nightlies-*",
            ]
          }
        }
      }
    ]
  })
}

# Single inline policy — full CI permissions (ECR, EC2, SSM, S3, CloudFront)
resource "aws_iam_role_policy" "ci" {
  name = "tee-rex-ci-policy"
  role = aws_iam_role.ci.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ECRAuth"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "ECRPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:CompleteLayerUpload",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ]
        Resource = aws_ecr_repository.tee_rex.arn
      },
      {
        Sid    = "EC2StartStop"
        Effect = "Allow"
        Action = [
          "ec2:StartInstances",
          "ec2:StopInstances",
        ]
        Resource = "arn:aws:ec2:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:instance/*"
        Condition = {
          StringEquals = {
            "aws:ResourceTag/Environment" = ["ci", "prod", "devnet"]
          }
        }
      },
      {
        Sid    = "EC2Describe"
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:DescribeInstanceStatus",
        ]
        Resource = "*"
      },
      {
        Sid      = "SSMSendCommandInstance"
        Effect   = "Allow"
        Action   = "ssm:SendCommand"
        Resource = "arn:aws:ec2:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:instance/*"
        Condition = {
          StringEquals = {
            "aws:ResourceTag/Environment" = ["ci", "prod", "devnet"]
          }
        }
      },
      {
        Sid      = "SSMSendCommandDocument"
        Effect   = "Allow"
        Action   = "ssm:SendCommand"
        Resource = "arn:aws:ssm:${data.aws_region.current.name}::document/AWS-RunShellScript"
      },
      {
        Sid    = "SSMStartSessionInstance"
        Effect = "Allow"
        Action = [
          "ssm:StartSession",
          "ssm:TerminateSession",
        ]
        Resource = "arn:aws:ec2:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:instance/*"
        Condition = {
          StringEquals = {
            "aws:ResourceTag/Environment" = ["ci", "prod", "devnet"]
          }
        }
      },
      {
        Sid      = "SSMStartSessionDocument"
        Effect   = "Allow"
        Action   = "ssm:StartSession"
        Resource = "arn:aws:ssm:${data.aws_region.current.name}::document/AWS-StartPortForwardingSession"
      },
      {
        Sid    = "SSMReadResults"
        Effect = "Allow"
        Action = [
          "ssm:GetCommandInvocation",
          "ssm:ListCommandInvocations",
          "ssm:DescribeInstanceInformation",
        ]
        Resource = "*"
      },
      {
        Sid    = "S3AppDeploy"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:ListBucket",
          "s3:GetBucketLocation",
        ]
        Resource = [
          aws_s3_bucket.prod.arn,
          "${aws_s3_bucket.prod.arn}/*",
          aws_s3_bucket.devnet.arn,
          "${aws_s3_bucket.devnet.arn}/*",
        ]
      },
      {
        Sid    = "S3AppCleanup"
        Effect = "Allow"
        Action = "s3:DeleteObject"
        Resource = [
          "${aws_s3_bucket.prod.arn}/*",
          "${aws_s3_bucket.devnet.arn}/*",
        ]
      },
      {
        Sid    = "CloudFrontInvalidation"
        Effect = "Allow"
        Action = "cloudfront:CreateInvalidation"
        Resource = [
          aws_cloudfront_distribution.prod.arn,
          aws_cloudfront_distribution.devnet.arn,
        ]
      },
    ]
  })
}

# -----------------------------------------------------------------------------
# EC2 Instance Role (SSM + ECR read)
# -----------------------------------------------------------------------------

resource "aws_iam_role" "ec2" {
  name = "tee-rex-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ec2_ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "ec2_ecr" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_instance_profile" "ec2" {
  name = "tee-rex-ec2-profile"
  role = aws_iam_role.ec2.name
}
