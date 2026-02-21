terraform {
  backend "s3" {
    bucket       = "tee-rex-tofu-state"
    key          = "terraform.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true
  }
}
