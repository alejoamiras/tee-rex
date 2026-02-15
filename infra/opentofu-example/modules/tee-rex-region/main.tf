# ============================================================================
# tee-rex-region module — everything needed to run tee-rex in ONE region.
#
# This file is the equivalent of your current:
#   - infra/ci-deploy.sh (TEE instance setup)
#   - infra/ci-deploy-prover.sh (Prover instance setup)
#   - Security group creation (manual AWS console today)
#   - Elastic IP allocation (manual today)
#
# The key difference: this is DECLARATIVE. You describe what you want,
# not the steps to get there. OpenTofu figures out the order automatically.
# ============================================================================

# ============================================================================
# Data sources — read-only lookups of existing AWS resources.
# These don't create anything, they just fetch information.
# ============================================================================

# Look up the CloudFront managed prefix list for this region.
# This is what allows CloudFront to reach the EC2 instances.
# Currently, you look this up manually and paste the ID into security group rules.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# Look up the latest Amazon Linux 2 AMI.
# No more manually finding AMI IDs per region!
data "aws_ami" "amazon_linux_2" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}

# ============================================================================
# Security Group
#
# Replaces: manually creating SG in AWS console + adding CloudFront prefix list rule.
# If you delete this from the .tf file, OpenTofu will delete it from AWS too.
# ============================================================================

resource "aws_security_group" "tee_rex" {
  name        = "tee-rex-${var.environment}-${var.region_name}"
  description = "Allow CloudFront to reach tee-rex backends (ports 80 + 4000)"

  # Single rule covering both prover (80) and TEE (4000) ports.
  # Uses CloudFront's managed prefix list — same as current setup.
  ingress {
    description     = "CloudFront to backends"
    from_port       = 80
    to_port         = 4000
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  # Allow all outbound traffic (Docker pulls, Aztec node communication, etc.)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "tee-rex-${var.environment}-${var.region_name}"
  }
}

# ============================================================================
# IAM Instance Profile — allows EC2 to be managed via SSM (no SSH needed)
#
# Replaces: manually attaching AmazonSSMManagedInstanceCore policy in console.
# ============================================================================

resource "aws_iam_role" "ec2_ssm" {
  name = "tee-rex-ec2-ssm-${var.region_name}"

  # This "assume role policy" says: "EC2 instances can assume this role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2_ssm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Also need ECR pull access so instances can pull Docker images
resource "aws_iam_role_policy_attachment" "ecr_pull" {
  role       = aws_iam_role.ec2_ssm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_instance_profile" "ec2" {
  name = "tee-rex-ec2-${var.region_name}"
  role = aws_iam_role.ec2_ssm.name
}

# ============================================================================
# Prover Instance
#
# `count` is how you conditionally create resources:
#   count = 1  → resource is created
#   count = 0  → resource is NOT created (skipped entirely)
#
# This is how deploy_prover = false in terraform.tfvars skips the prover.
# ============================================================================

resource "aws_instance" "prover" {
  count = var.region_config.deploy_prover ? 1 : 0

  ami                    = data.aws_ami.amazon_linux_2.id
  instance_type          = var.region_config.prover_instance
  key_name               = var.key_pair_name
  vpc_security_group_ids = [aws_security_group.tee_rex.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  # 20 GB root volume — enough to cache Docker layers (Phase 20A fix)
  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }

  # User data runs on first boot. This installs Docker and pulls the image.
  # Similar to what ci-deploy-prover.sh does, but only on initial creation.
  # Subsequent deploys would be handled by SSM commands (same as today).
  user_data = <<-SCRIPT
    #!/bin/bash
    yum update -y
    amazon-linux-extras install docker -y
    systemctl enable docker
    systemctl start docker

    # Login to ECR and pull the image
    aws ecr get-login-password --region ${var.region_config.region} | \
      docker login --username AWS --password-stdin ${var.ecr_registry}
    docker pull ${var.ecr_registry}/${var.ecr_repository}:${var.image_tag}

    # Run the prover container
    docker run -d \
      --name tee-rex \
      --restart unless-stopped \
      -p 80:80 \
      ${var.ecr_registry}/${var.ecr_repository}:${var.image_tag}
  SCRIPT

  tags = {
    Name        = "tee-rex-prover-${var.environment}-${var.region_name}"
    Service     = "prover"
    Environment = var.environment
  }
}

# Elastic IP for stable DNS — same as current setup.
# CloudFront origins need a stable domain/IP that doesn't change on reboot.
resource "aws_eip" "prover" {
  count    = var.region_config.deploy_prover ? 1 : 0
  instance = aws_instance.prover[0].id
  domain   = "vpc"

  tags = {
    Name = "tee-rex-prover-${var.environment}-${var.region_name}"
  }
}

# ============================================================================
# TEE Instance (Nitro Enclave)
#
# Same pattern as prover, but with enclave_options enabled.
# The enclave_options block is what makes this a Nitro Enclave-capable instance.
# ============================================================================

resource "aws_instance" "tee" {
  count = var.region_config.deploy_tee ? 1 : 0

  ami                    = data.aws_ami.amazon_linux_2.id
  instance_type          = var.region_config.tee_instance # m5.xlarge — must support enclaves
  key_name               = var.key_pair_name
  vpc_security_group_ids = [aws_security_group.tee_rex.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  # THIS is the magic line that enables Nitro Enclaves on the instance.
  # Without this, `nitro-cli` commands won't work.
  enclave_options {
    enabled = true
  }

  root_block_device {
    volume_size = 20 # Phase 20A: bigger disk for Docker layer caching
    volume_type = "gp3"
  }

  # TEE user data is more complex — needs nitro-cli, allocator config, etc.
  # In practice, you'd reference the ci-deploy.sh script here.
  user_data = <<-SCRIPT
    #!/bin/bash
    yum update -y
    amazon-linux-extras install docker aws-nitro-enclaves-cli -y
    yum install aws-nitro-enclaves-cli-devel -y

    systemctl enable docker
    systemctl start docker
    systemctl enable nitro-enclaves-allocator
    systemctl start nitro-enclaves-allocator

    # Login to ECR and pull the TEE image
    aws ecr get-login-password --region ${var.region_config.region} | \
      docker login --username AWS --password-stdin ${var.ecr_registry}
    docker pull ${var.ecr_registry}/${var.ecr_repository}:${var.image_tag}

    # Build and run the enclave (simplified — real version is in ci-deploy.sh)
    nitro-cli build-enclave \
      --docker-uri ${var.ecr_registry}/${var.ecr_repository}:${var.image_tag} \
      --output-file /home/ec2-user/tee-rex.eif

    nitro-cli run-enclave \
      --cpu-count 2 \
      --memory 6144 \
      --eif-path /home/ec2-user/tee-rex.eif \
      --enclave-cid 16

    # Bridge vsock to TCP (same as infra/proxy.sh)
    nohup socat TCP-LISTEN:4000,reuseaddr,fork VSOCK-CONNECT:16:5000 &
  SCRIPT

  tags = {
    Name        = "tee-rex-tee-${var.environment}-${var.region_name}"
    Service     = "tee"
    Environment = var.environment
  }
}

resource "aws_eip" "tee" {
  count    = var.region_config.deploy_tee ? 1 : 0
  instance = aws_instance.tee[0].id
  domain   = "vpc"

  tags = {
    Name = "tee-rex-tee-${var.environment}-${var.region_name}"
  }
}

# ============================================================================
# What `tofu plan` would show for the MVP (prover-only in São Paulo):
#
# module.sao_paulo.aws_security_group.tee_rex: Creating...
# module.sao_paulo.aws_iam_role.ec2_ssm: Creating...
# module.sao_paulo.aws_instance.prover[0]: Creating...
# module.sao_paulo.aws_eip.prover[0]: Creating...
#
# Plan: 4 to add, 0 to change, 0 to destroy.
#
# Notice: NO tee instance — because deploy_tee = false in the config.
# Flip it to true, run `tofu plan` again, and you'll see 2 more resources.
# ============================================================================
