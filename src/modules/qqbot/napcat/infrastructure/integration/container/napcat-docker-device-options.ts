import type { NapcatDeviceIdentity } from '../../persistence/napcat-device-identity.entity';

export type NapcatDockerDeviceOptions = {
  dataDir: string;
  deviceEnvPath: string;
  deviceIdentityId?: string;
  hostname: string;
  machineIdPath: string;
  macAddress: string;
  runFlags: string[];
};

/**
 * 执行 NapCat 登录运行态流程。
 * @param identity - Persisted device identity row that supplies stable directory, hostname, machine-id, and MAC values for Docker.
 * @returns Docker option bundle used by remote create scripts.
 */
export function toNapcatDockerDeviceOptions(
  identity: Pick<
    NapcatDeviceIdentity,
    'dataDir' | 'hostname' | 'id' | 'machineIdPath' | 'macAddress'
  >,
): NapcatDockerDeviceOptions {
  return {
    dataDir: identity.dataDir,
    deviceEnvPath: `${identity.dataDir}/device.env`,
    deviceIdentityId: identity.id,
    hostname: identity.hostname,
    machineIdPath: identity.machineIdPath,
    macAddress: identity.macAddress,
    runFlags: [
      '--hostname "$NAPCAT_HOSTNAME"',
      '--mac-address "$NAPCAT_MAC_ADDRESS"',
      '-v "$MACHINE_ID_PATH:/etc/machine-id:ro"',
    ],
  };
}
