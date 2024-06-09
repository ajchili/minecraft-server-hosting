import * as pulumi from "@pulumi/pulumi";
import * as compute from "@pulumi/azure-native/compute";
import * as resources from "@pulumi/azure-native/resources";
import * as network from "@pulumi/azure-native/network";
import * as random from "@pulumi/random";
import * as tls from "@pulumi/tls";

const config = new pulumi.Config();

const vmName = config.get("vmName") || "my-server";
const osImage =
  config.get("osImage") ||
  "canonical:0001-com-ubuntu-server-jammy:22_04-lts:latest";
const [osImagePublisher, osImageOffer, osImageSku, osImageVersion] =
  osImage.split(":");
const adminUsername = config.get("adminUsername") || "pulumiuser";
const servicePort = config.get("servicePort") || "25565";

const sshKey = new tls.PrivateKey("ssh-key", {
  algorithm: "RSA",
  rsaBits: 4096,
});

// Create an Azure Resource Group
const resourceGroup = new resources.ResourceGroup(
  "minecraft-server-resource-group",
  { location: "EastUS" }
);

const virtualNetwork = new network.VirtualNetwork("network", {
  resourceGroupName: resourceGroup.name,
  addressSpace: {
    addressPrefixes: ["10.0.0.0/16"],
  },
  subnets: [
    {
      name: `subnet`,
      addressPrefix: "10.0.1.0/24",
    },
  ],
});

// Use a random string to give the VM a unique DNS name
var domainNameLabel = new random.RandomString("domain-label", {
  length: 8,
  upper: false,
  special: false,
}).result.apply((result) => `${vmName}-${result}`);

// Create a public IP address for the VM
const publicIp = new network.PublicIPAddress("public-ip", {
  resourceGroupName: resourceGroup.name,
  publicIPAllocationMethod: network.IPAllocationMethod.Dynamic,
  dnsSettings: {
    domainNameLabel: domainNameLabel,
  },
});

const securityGroup = new network.NetworkSecurityGroup("security-group", {
  resourceGroupName: resourceGroup.name,
  securityRules: [
    {
      name: `securityrule`,
      priority: 1000,
      direction: network.AccessRuleDirection.Inbound,
      access: "Allow",
      protocol: "Tcp",
      sourcePortRange: "*",
      sourceAddressPrefix: "*",
      destinationAddressPrefix: "*",
      destinationPortRanges: [servicePort, "22"],
    },
  ],
});

// Create a network interface with the virtual network, IP address, and security group
const networkInterface = new network.NetworkInterface("network-interface", {
  resourceGroupName: resourceGroup.name,
  networkSecurityGroup: {
    id: securityGroup.id,
  },
  ipConfigurations: [
    {
      name: `ipconfiguration`,
      privateIPAllocationMethod: network.IPAllocationMethod.Dynamic,
      subnet: {
        id: virtualNetwork.subnets.apply((subnets) => subnets![0].id!),
      },
      publicIPAddress: {
        id: publicIp.id,
      },
    },
  ],
});

const vm = new compute.VirtualMachine("server-instance", {
  resourceGroupName: resourceGroup.name,
  networkProfile: {
    networkInterfaces: [
      {
        id: networkInterface.id,
        primary: true,
      },
    ],
  },
  hardwareProfile: {
    vmSize: compute.VirtualMachineSizeTypes.Standard_D2_v2,
  },
  storageProfile: {
    // osDisk: {
    //   createOption: compute.DiskCreateOptionTypes.Attach,
    //   deleteOption: compute.DiskDeleteOptionTypes.Delete,
    //   diskSizeGB: 20,
    //   osType: compute.OperatingSystemTypes.Linux,
    //   managedDisk: {},
    // },
    osDisk: {
      createOption: compute.DiskCreateOptionTypes.FromImage,
    },
    imageReference: {
      publisher: osImagePublisher,
      offer: osImageOffer,
      sku: osImageSku,
      version: osImageVersion,
    },
  },
  osProfile: {
    adminUsername: adminUsername,
    computerName: "server",
    customData: Buffer.from(
      `
      #!/bin/bash
      sudo apt update -y
      sudo apt install openjdk-17-jre-headless -y
      mkdir ~/fabric-server
      `
    ).toString("base64"),
    linuxConfiguration: {
      disablePasswordAuthentication: true,
      ssh: {
        publicKeys: [
          {
            keyData: sshKey.publicKeyOpenssh,
            path: `/home/${adminUsername}/.ssh/authorized_keys`,
          },
        ],
      },
    },
  },
});

// Once the machine is created, fetch its IP address and DNS hostname
const vmAddress = vm.id.apply((_) =>
  network.getPublicIPAddressOutput({
    resourceGroupName: resourceGroup.name,
    publicIpAddressName: publicIp.name,
  })
);

// Export the VM's hostname, public IP address, HTTP URL, and SSH private key
export const ip = vmAddress.ipAddress;
export const hostname = vmAddress.dnsSettings?.apply(
  (settings) => settings?.fqdn
);
export const url = hostname?.apply((name) => `http://${name}:${servicePort}`);
export const privatekey = sshKey.privateKeyOpenssh;
