# -----------------------------------------------------------------------------
# Key Pair
# -----------------------------------------------------------------------------

resource "aws_key_pair" "tee_rex" {
  key_name   = var.ec2_key_name
  public_key = var.ec2_public_key

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [public_key]
  }
}

# -----------------------------------------------------------------------------
# CI Instance (stopped by default, started/stopped by GitHub Actions)
# -----------------------------------------------------------------------------

resource "aws_instance" "ci_tee" {
  ami                    = var.instance_amis.ci_tee
  instance_type          = "m5.xlarge"
  key_name               = aws_key_pair.tee_rex.key_name
  subnet_id              = var.default_subnet_id
  vpc_security_group_ids = [aws_security_group.tee_rex.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  enclave_options {
    enabled = true
  }

  root_block_device {
    encrypted = true
  }

  tags = {
    Name        = "tee-rex-ci"
    Environment = "ci"
  }

  lifecycle {
    ignore_changes = [ami, user_data, user_data_base64, root_block_device]
  }
}

# -----------------------------------------------------------------------------
# Production Instance
# -----------------------------------------------------------------------------

resource "aws_instance" "prod_tee" {
  ami                    = var.instance_amis.prod_tee
  instance_type          = "m5.xlarge"
  key_name               = aws_key_pair.tee_rex.key_name
  subnet_id              = var.default_subnet_id
  vpc_security_group_ids = [aws_security_group.tee_rex.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  enclave_options {
    enabled = true
  }

  root_block_device {
    encrypted = true
  }

  tags = {
    Name        = "tee-rex-prod"
    Environment = "prod"
  }

  lifecycle {
    ignore_changes = [ami, user_data, user_data_base64, root_block_device]
  }
}

# -----------------------------------------------------------------------------
# Devnet Instance
# -----------------------------------------------------------------------------

resource "aws_instance" "devnet_tee" {
  ami                    = var.instance_amis.devnet_tee
  instance_type          = "m5.xlarge"
  key_name               = aws_key_pair.tee_rex.key_name
  subnet_id              = var.default_subnet_id
  vpc_security_group_ids = [aws_security_group.tee_rex.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  enclave_options {
    enabled = true
  }

  root_block_device {
    encrypted = true
  }

  tags = {
    Name        = "tee-rex-devnet"
    Environment = "devnet"
  }

  lifecycle {
    ignore_changes = [ami, user_data, user_data_base64, root_block_device]
  }
}