import type { NapcatDeviceIdentity } from '../../persistence/napcat-device-identity.entity';

export type NapcatDockerDeviceOptions = {
  dataDir: string;
  deviceEnvPath: string;
  hostname: string;
  machineIdPath: string;
  macAddress: string;
  runFlags: string[];
};

/**
 * 执行 NapCat 登录运行态流程。
 * @param identity - identity 输入；使用 `dataDir`、`hostname`、`machineIdPath`、`macAddress` 字段生成结果。
 * @returns NapCat 登录运行态产出的 NapcatDockerDeviceOptions。
 */
export function toNapcatDockerDeviceOptions(
  identity: Pick<
    NapcatDeviceIdentity,
    'dataDir' | 'hostname' | 'machineIdPath' | 'macAddress'
  >,
): NapcatDockerDeviceOptions {
  return {
    dataDir: identity.dataDir,
    deviceEnvPath: `${identity.dataDir}/device.env`,
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
