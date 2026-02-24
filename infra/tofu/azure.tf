# -----------------------------------------------------------------------------
# Azure SGX VMs — per-environment (prod, devnet, ci)
#
# Each environment gets: resource group, VNet, subnet, NSG, public IP, NIC, VM.
# All VMs use Standard_DC4ds_v3 (4 vCPU, 32GB RAM, 16GB EPC, ~$0.45/hr).
# The spike VM (Phase 15E) was promoted to prod via state moves.
# -----------------------------------------------------------------------------

locals {
  sgx_environments = toset(["prod", "devnet", "ci"])
  sgx_location     = "East US"
  # Each environment uses a distinct /16 to avoid address conflicts
  sgx_address_spaces = {
    prod   = "10.0.0.0/16"
    devnet = "10.1.0.0/16"
    ci     = "10.2.0.0/16"
  }
  sgx_subnet_prefixes = {
    prod   = "10.0.1.0/24"
    devnet = "10.1.1.0/24"
    ci     = "10.2.1.0/24"
  }
}

# Resource groups — single destroy target cleans up everything per env
resource "azurerm_resource_group" "sgx" {
  for_each = local.sgx_environments
  name     = "tee-rex-sgx-${each.key}"
  location = local.sgx_location
}

# Network
resource "azurerm_virtual_network" "sgx" {
  for_each            = local.sgx_environments
  name                = "sgx-${each.key}-vnet"
  address_space       = [local.sgx_address_spaces[each.key]]
  location            = azurerm_resource_group.sgx[each.key].location
  resource_group_name = azurerm_resource_group.sgx[each.key].name
}

resource "azurerm_subnet" "sgx" {
  for_each             = local.sgx_environments
  name                 = "sgx-${each.key}-subnet"
  resource_group_name  = azurerm_resource_group.sgx[each.key].name
  virtual_network_name = azurerm_virtual_network.sgx[each.key].name
  address_prefixes     = [local.sgx_subnet_prefixes[each.key]]
}

resource "azurerm_network_security_group" "sgx" {
  for_each            = local.sgx_environments
  name                = "sgx-${each.key}-nsg"
  location            = azurerm_resource_group.sgx[each.key].location
  resource_group_name = azurerm_resource_group.sgx[each.key].name

  security_rule {
    name                       = "SSH"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "TEE-Rex-Server"
    priority                   = 1002
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "4000"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "sgx" {
  for_each                  = local.sgx_environments
  subnet_id                 = azurerm_subnet.sgx[each.key].id
  network_security_group_id = azurerm_network_security_group.sgx[each.key].id
}

resource "azurerm_public_ip" "sgx" {
  for_each            = local.sgx_environments
  name                = "sgx-${each.key}-pip"
  location            = azurerm_resource_group.sgx[each.key].location
  resource_group_name = azurerm_resource_group.sgx[each.key].name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_network_interface" "sgx" {
  for_each            = local.sgx_environments
  name                = "sgx-${each.key}-nic"
  location            = azurerm_resource_group.sgx[each.key].location
  resource_group_name = azurerm_resource_group.sgx[each.key].name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.sgx[each.key].id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.sgx[each.key].id
  }
}

# VMs — Standard_DC4ds_v3: 4 vCPU, 32GB RAM, 16GB EPC (~$0.45/hr)
resource "azurerm_linux_virtual_machine" "sgx" {
  for_each            = local.sgx_environments
  name                = "tee-rex-sgx-${each.key}"
  resource_group_name = azurerm_resource_group.sgx[each.key].name
  location            = azurerm_resource_group.sgx[each.key].location
  size                = "Standard_DC4ds_v3"
  admin_username      = "azureuser"

  network_interface_ids = [
    azurerm_network_interface.sgx[each.key].id,
  ]

  admin_ssh_key {
    username   = "azureuser"
    public_key = var.azure_ssh_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = 64
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  lifecycle {
    ignore_changes = [source_image_reference]
  }
}

# -----------------------------------------------------------------------------
# State moves — promote spike resources to prod
# Run `tofu plan` to verify before `tofu apply`.
# These can be removed after the first successful apply.
# -----------------------------------------------------------------------------

moved {
  from = azurerm_resource_group.sgx_spike
  to   = azurerm_resource_group.sgx["prod"]
}

moved {
  from = azurerm_virtual_network.sgx_spike
  to   = azurerm_virtual_network.sgx["prod"]
}

moved {
  from = azurerm_subnet.sgx_spike
  to   = azurerm_subnet.sgx["prod"]
}

moved {
  from = azurerm_network_security_group.sgx_spike
  to   = azurerm_network_security_group.sgx["prod"]
}

moved {
  from = azurerm_subnet_network_security_group_association.sgx_spike
  to   = azurerm_subnet_network_security_group_association.sgx["prod"]
}

moved {
  from = azurerm_public_ip.sgx_spike
  to   = azurerm_public_ip.sgx["prod"]
}

moved {
  from = azurerm_network_interface.sgx_spike
  to   = azurerm_network_interface.sgx["prod"]
}

moved {
  from = azurerm_linux_virtual_machine.sgx_spike
  to   = azurerm_linux_virtual_machine.sgx["prod"]
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "sgx_prod_public_ip" {
  description = "Public IP of the production SGX VM"
  value       = azurerm_public_ip.sgx["prod"].ip_address
}

output "sgx_prod_ssh" {
  description = "SSH command for production SGX VM"
  value       = "ssh azureuser@${azurerm_public_ip.sgx["prod"].ip_address}"
}

output "sgx_devnet_public_ip" {
  description = "Public IP of the devnet SGX VM"
  value       = azurerm_public_ip.sgx["devnet"].ip_address
}

output "sgx_devnet_ssh" {
  description = "SSH command for devnet SGX VM"
  value       = "ssh azureuser@${azurerm_public_ip.sgx["devnet"].ip_address}"
}

output "sgx_ci_public_ip" {
  description = "Public IP of the CI SGX VM"
  value       = azurerm_public_ip.sgx["ci"].ip_address
}

output "sgx_ci_ssh" {
  description = "SSH command for CI SGX VM"
  value       = "ssh azureuser@${azurerm_public_ip.sgx["ci"].ip_address}"
}
