# -----------------------------------------------------------------------------
# Azure SGX spike (Phase 15E)
# Minimal DCdsv3 VM with Intel SGX for feasibility testing.
# Destroy after spike: tofu destroy -target=azurerm_resource_group.sgx_spike
# -----------------------------------------------------------------------------

# Resource group — single destroy target cleans up everything
resource "azurerm_resource_group" "sgx_spike" {
  name     = "tee-rex-sgx-spike"
  location = "East US"
}

# Network
resource "azurerm_virtual_network" "sgx_spike" {
  name                = "sgx-spike-vnet"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.sgx_spike.location
  resource_group_name = azurerm_resource_group.sgx_spike.name
}

resource "azurerm_subnet" "sgx_spike" {
  name                 = "sgx-spike-subnet"
  resource_group_name  = azurerm_resource_group.sgx_spike.name
  virtual_network_name = azurerm_virtual_network.sgx_spike.name
  address_prefixes     = ["10.0.1.0/24"]
}

resource "azurerm_network_security_group" "sgx_spike" {
  name                = "sgx-spike-nsg"
  location            = azurerm_resource_group.sgx_spike.location
  resource_group_name = azurerm_resource_group.sgx_spike.name

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
}

resource "azurerm_subnet_network_security_group_association" "sgx_spike" {
  subnet_id                 = azurerm_subnet.sgx_spike.id
  network_security_group_id = azurerm_network_security_group.sgx_spike.id
}

resource "azurerm_public_ip" "sgx_spike" {
  name                = "sgx-spike-pip"
  location            = azurerm_resource_group.sgx_spike.location
  resource_group_name = azurerm_resource_group.sgx_spike.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_network_interface" "sgx_spike" {
  name                = "sgx-spike-nic"
  location            = azurerm_resource_group.sgx_spike.location
  resource_group_name = azurerm_resource_group.sgx_spike.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.sgx_spike.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.sgx_spike.id
  }
}

# VM — Standard_DC4ds_v3: 4 vCPU, 32GB RAM, 16GB EPC (~$0.45/hr)
resource "azurerm_linux_virtual_machine" "sgx_spike" {
  name                = "tee-rex-sgx-spike"
  resource_group_name = azurerm_resource_group.sgx_spike.name
  location            = azurerm_resource_group.sgx_spike.location
  size                = "Standard_DC4ds_v3"
  admin_username      = "azureuser"

  network_interface_ids = [
    azurerm_network_interface.sgx_spike.id,
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

# Outputs
output "sgx_spike_public_ip" {
  description = "Public IP of the SGX spike VM"
  value       = azurerm_public_ip.sgx_spike.ip_address
}

output "sgx_spike_ssh" {
  description = "SSH command for SGX spike VM"
  value       = "ssh azureuser@${azurerm_public_ip.sgx_spike.ip_address}"
}
