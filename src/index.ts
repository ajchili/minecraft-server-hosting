import * as pulumi from "@pulumi/pulumi";
import * as resources from "@pulumi/azure-native/resources";
import * as tls from "@pulumi/tls";

import { getConfigValue } from "./utils";
import { createMinecraftServer } from "./instance";

const config = new pulumi.Config();

const virtualMachineName = getConfigValue("virtualMachineName", "mc-server");
const osImage =
  config.get("osImage") ||
  "canonical:0001-com-ubuntu-server-jammy:22_04-lts:latest";

const sshKey = new tls.PrivateKey("ssh-key", {
  algorithm: "RSA",
  rsaBits: 4096,
});

// Create an Azure Resource Group
const resourceGroup = new resources.ResourceGroup(
  "minecraft-server-resource-group",
  { location: "EastUS" }
);

export const { hostname, ip, url } = createMinecraftServer({
  osImage,
  resourceGroup,
  sshKey,
  virtualMachineName: "mc-server",
});
