# Phase 30: SGX Migration from Azure to Alibaba Cloud

## Context

Azure DCdsv3 quota permanently blocked (0/0 across all regions despite multiple support tickets). Migrating SGX infrastructure to Alibaba Cloud g7t instances (Intel SGX, Ice Lake).

## Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Cloud provider | Alibaba Cloud (g7t.xlarge) | SGX available in HK/SG/Jakarta; Azure quota blocked |
| Instance type | ecs.g7t.xlarge (4 vCPU, 16GB RAM, 8GB EPC) | Sufficient for bb (~283MB peak) + Gramine overhead |
| Region | cn-hongkong (Zone B) | Confirmed g7t availability; reasonable latency to EU |
| Attestation | Intel Trust Authority (ITA) | Cloud-agnostic; Azure MAA may only cache Azure PCK certs |
| PCCS | Alibaba Cloud regional PCCS | Required for DCAP quote collateral on Alibaba hardware |
| CI deploy | SSH-based (was Azure OIDC + az vm run-command) | Simpler, cloud-agnostic |

## Files Changed

| File | Change |
|------|--------|
| `infra/sgx-spike/setup-alibaba.sh` | New: Alibaba-specific setup (PCCS config, no Azure DCAP) |
| `infra/tofu/azure.tf` → `alibaba-sgx.tf` | Replace Azure RG/VNet/NSG/VM with Alibaba VPC/VSwitch/SG/ECS |
| `infra/tofu/providers.tf` | Replace azurerm → alicloud |
| `infra/tofu/versions.tf` | Replace azurerm → alicloud provider |
| `infra/tofu/variables.tf` | Replace Azure vars with Alibaba vars + hardened SG vars |
| `infra/tofu/cloudfront.tf` | Update SGX origin from Azure FQDN to Alibaba EIP |
| `packages/sdk/src/lib/sgx-attestation.ts` | Replace Azure MAA with Intel Trust Authority |
| `packages/sdk/src/lib/sgx-attestation.test.ts` | Update mocks for ITA claim names |
| `packages/app/vite.config.ts` | Replace /maa proxy with /ita + /ita-certs proxies |
| `.github/workflows/_deploy-sgx.yml` | Replace Azure OIDC with SSH-based deploy |
| `infra/sgx-spike/ci-deploy-sgx.sh` | Update default user (azureuser → ecs-user) |
| `docs/architecture.md` | Update all Azure/MAA references to Alibaba/ITA |
| `docs/sgx-deployment.md` | Rewrite for Alibaba provisioning |

## Approach Log

| # | Approach | Result |
|---|---------|--------|
| 1 | Incremental migration — code changes first, infra provisioning manual | In progress |
