# Elastic IPs for prod and devnet instances (CI instance doesn't need a static IP)

# -----------------------------------------------------------------------------
# Production EIP
# -----------------------------------------------------------------------------

resource "aws_eip" "prod_tee" {
  domain = "vpc"

  tags = {
    Name        = "tee-rex-prod"
    Environment = "prod"
  }
}

resource "aws_eip_association" "prod_tee" {
  instance_id   = aws_instance.prod_tee.id
  allocation_id = aws_eip.prod_tee.id
}
