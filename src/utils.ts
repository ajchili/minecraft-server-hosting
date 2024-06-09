import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

export function getConfigValue(name: string, defaultValue: string): string {
  return config.get(name) || defaultValue;
}
