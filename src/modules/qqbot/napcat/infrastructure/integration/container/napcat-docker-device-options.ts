import type { NapcatDeviceIdentity } from '../../persistence/napcat-device-identity.entity';

export type NapcatDockerDeviceOptions = {
  accountId: string;
  dataDir: string;
  deviceEnvPath: string;
  deviceIdentityId?: string;
  hostname: string;
  machineIdPath: string;
  machineInfoPath: string;
  macAddress: string;
  macAddressHyphen: string;
  hostnameStrategy?: string;
  macStrategy?: string;
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
    | 'accountId'
    | 'dataDir'
    | 'hostname'
    | 'hostnameStrategy'
    | 'id'
    | 'machineIdPath'
    | 'macAddress'
    | 'macStrategy'
  >,
): NapcatDockerDeviceOptions {
  const machineInfoPath = `${identity.dataDir}/QQ/nt_qq/global/nt_data/msf/machine-info`;

  return {
    accountId: identity.accountId,
    dataDir: identity.dataDir,
    deviceEnvPath: `${identity.dataDir}/device.env`,
    deviceIdentityId: identity.id,
    hostname: identity.hostname,
    hostnameStrategy: identity.hostnameStrategy,
    machineIdPath: identity.machineIdPath,
    machineInfoPath,
    macAddress: identity.macAddress,
    macAddressHyphen: identity.macAddress.replace(/:/g, '-').toLowerCase(),
    macStrategy: identity.macStrategy,
    runFlags: [
      '--hostname "$NAPCAT_HOSTNAME"',
      '--mac-address "$NAPCAT_MAC_ADDRESS"',
      '-v "$MACHINE_ID_PATH:/etc/machine-id:ro"',
    ],
  };
}
