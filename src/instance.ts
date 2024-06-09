import * as compute from "@pulumi/azure-native/compute";
import * as resources from "@pulumi/azure-native/resources";
import * as network from "@pulumi/azure-native/network";
import * as random from "@pulumi/random";
import * as tls from "@pulumi/tls";

const MINECRAFT_PORT_AS_STRING = "25565";

export interface CreateDependenciesProps {
  resourceGroup: resources.ResourceGroup;
  virtualMachineName: string;
}

export interface CreateInstanceProps {
  adminUsername?: string;
  osImage: string;
  resourceGroup: resources.ResourceGroup;
  sshKey: tls.PrivateKey;
  virtualMachineName: string;
}

function createDependencies({
  resourceGroup,
  virtualMachineName,
}: CreateDependenciesProps) {
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
  }).result.apply((result) => `${virtualMachineName}-${result}`);

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
        destinationPortRanges: [MINECRAFT_PORT_AS_STRING, "22"],
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

  return {
    publicIp,
    networkInterface,
  };
}

export function createMinecraftServer({
  adminUsername = "pulumiuser",
  osImage,
  resourceGroup,
  sshKey,
  virtualMachineName,
}: CreateInstanceProps) {
  const [osImagePublisher, osImageOffer, osImageSku, osImageVersion] =
    osImage.split(":");
  const { publicIp, networkInterface } = createDependencies({
    resourceGroup,
    virtualMachineName,
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
      computerName: virtualMachineName,
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

  const vmAddress = vm.id.apply((_) =>
    network.getPublicIPAddressOutput({
      resourceGroupName: resourceGroup.name,
      publicIpAddressName: publicIp.name,
    })
  );

  // Export the VM's hostname, public IP address, HTTP URL, and SSH private key
  const ip = vmAddress.ipAddress;
  const hostname = vmAddress.dnsSettings?.apply((settings) => settings?.fqdn);
  const url = hostname?.apply(
    (name) => `http://${name}:${MINECRAFT_PORT_AS_STRING}`
  );

  return {
    ip,
    hostname,
    url
  };
}
