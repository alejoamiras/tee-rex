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
# CI Instances (stopped by default, started/stopped by GitHub Actions)
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
    Name        = "tee-rex-nitro"
    Environment = "ci"
  }

  lifecycle {
    ignore_changes = [ami, user_data, user_data_base64, root_block_device]
  }
}

resource "aws_instance" "ci_prover" {
  ami                    = var.instance_amis.ci_prover
  instance_type          = "t3.xlarge"
  key_name               = aws_key_pair.tee_rex.key_name
  subnet_id              = var.default_subnet_id
  vpc_security_group_ids = [aws_security_group.tee_rex.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  root_block_device {
    encrypted = true
  }

  tags = {
    Name        = "tee-rex-prover-ci"
    Environment = "ci"
    Service     = "prover"
  }

  lifecycle {
    ignore_changes = [ami, user_data, user_data_base64, root_block_device]
  }
}

# -----------------------------------------------------------------------------
# Production Instances
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
    Name        = "tee-rex-prod-tee"
    Environment = "prod"
    Service     = "tee"
  }

  lifecycle {
    ignore_changes = [ami, user_data, user_data_base64, root_block_device]
  }
}

resource "aws_instance" "prod_prover" {
  ami                    = var.instance_amis.prod_prover
  instance_type          = "t3.xlarge"
  key_name               = aws_key_pair.tee_rex.key_name
  subnet_id              = var.default_subnet_id
  vpc_security_group_ids = [aws_security_group.tee_rex.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  root_block_device {
    encrypted = true
  }

  tags = {
    Name        = "tee-rex-prod-prover"
    Environment = "prod"
    Service     = "prover"
  }

  lifecycle {
    ignore_changes = [ami, user_data, user_data_base64, root_block_device]
  }
}

# -----------------------------------------------------------------------------
# Devnet Instances
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
    Name        = "tee-rex-devnet-tee"
    Environment = "devnet"
    Service     = "tee"
  }

  lifecycle {
    ignore_changes = [ami, user_data, user_data_base64, root_block_device]
  }
}

resource "aws_instance" "devnet_prover" {
  ami                    = var.instance_amis.devnet_prover
  instance_type          = "t3.xlarge"
  key_name               = aws_key_pair.tee_rex.key_name
  subnet_id              = var.default_subnet_id
  vpc_security_group_ids = [aws_security_group.tee_rex.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  root_block_device {
    encrypted = true
  }

  tags = {
    Name        = "tee-rex-devnet-prover"
    Environment = "devnet"
    Service     = "prover"
  }

  lifecycle {
    ignore_changes = [ami, user_data, user_data_base64, root_block_device]
  }
}
