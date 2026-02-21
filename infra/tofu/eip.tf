# Elastic IPs for prod and devnet instances (CI instances don't need static IPs)

# -----------------------------------------------------------------------------
# Production EIPs
# -----------------------------------------------------------------------------

resource "aws_eip" "prod_tee" {
  domain = "vpc"

  tags = {
    Name        = "tee-rex-prod-tee"
    Environment = "prod"
    Service     = "tee"
  }
}

resource "aws_eip_association" "prod_tee" {
  instance_id   = aws_instance.prod_tee.id
  allocation_id = aws_eip.prod_tee.id
}

resource "aws_eip" "prod_prover" {
  domain = "vpc"

  tags = {
    Name        = "tee-rex-prod-prover"
    Environment = "prod"
    Service     = "prover"
  }
}

resource "aws_eip_association" "prod_prover" {
  instance_id   = aws_instance.prod_prover.id
  allocation_id = aws_eip.prod_prover.id
}

# -----------------------------------------------------------------------------
# Devnet EIPs
# -----------------------------------------------------------------------------

resource "aws_eip" "devnet_tee" {
  domain = "vpc"

  tags = {
    Name        = "tee-rex-devnet-tee"
    Environment = "devnet"
  }
}

resource "aws_eip_association" "devnet_tee" {
  instance_id   = aws_instance.devnet_tee.id
  allocation_id = aws_eip.devnet_tee.id
}

resource "aws_eip" "devnet_prover" {
  domain = "vpc"

  tags = {
    Name        = "tee-rex-devnet-prover"
    Environment = "devnet"
  }
}

resource "aws_eip_association" "devnet_prover" {
  instance_id   = aws_instance.devnet_prover.id
  allocation_id = aws_eip.devnet_prover.id
}
