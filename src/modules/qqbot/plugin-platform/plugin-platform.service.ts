import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { parseQqbotPluginManifest, type QqbotPluginManifest } from './manifest';
import {
  QqbotPlugin,
  QqbotPluginAccountBinding,
  QqbotPluginAsset,
  QqbotPluginConfig,
  QqbotPluginEventHandler,
  QqbotPluginInstallation,
  QqbotPluginOperation,
  QqbotPluginRuntimeEvent,
  QqbotPluginVersion,
  type QqbotPluginInstallStatus,
} from './persistence';

type ValidateManifestBody = {
  manifest?: unknown;
};

type InstallLocalBody = {
  manifest?: unknown;
  packageHash?: string;
  packagePath?: string;
};

type InstallationActionBody = {
  id?: string;
};

type UpdateConfigBody = {
  configKey?: string;
  pluginId?: string;
  value?: unknown;
};

@Injectable()
export class QqbotPluginPlatformService {
  constructor(
    @InjectRepository(QqbotPlugin)
    private readonly pluginRepository: Repository<QqbotPlugin>,
    @InjectRepository(QqbotPluginVersion)
    private readonly versionRepository: Repository<QqbotPluginVersion>,
    @InjectRepository(QqbotPluginInstallation)
    private readonly installationRepository: Repository<QqbotPluginInstallation>,
    @InjectRepository(QqbotPluginOperation)
    private readonly operationRepository: Repository<QqbotPluginOperation>,
    @InjectRepository(QqbotPluginEventHandler)
    private readonly eventHandlerRepository: Repository<QqbotPluginEventHandler>,
    @InjectRepository(QqbotPluginAccountBinding)
    private readonly accountBindingRepository: Repository<QqbotPluginAccountBinding>,
    @InjectRepository(QqbotPluginConfig)
    private readonly configRepository: Repository<QqbotPluginConfig>,
    @InjectRepository(QqbotPluginAsset)
    private readonly assetRepository: Repository<QqbotPluginAsset>,
    @InjectRepository(QqbotPluginRuntimeEvent)
    private readonly runtimeEventRepository: Repository<QqbotPluginRuntimeEvent>,
  ) {}

  async listInstallations() {
    return this.installationRepository.find();
  }

  validateManifest(body: ValidateManifestBody) {
    return {
      manifest: parseQqbotPluginManifest(body.manifest),
      valid: true,
    };
  }

  async installLocal(body: InstallLocalBody) {
    const manifest = parseQqbotPluginManifest(body.manifest);
    const plugin = await this.pluginRepository.save({
      pluginKey: manifest.pluginKey,
      pluginName: manifest.name,
      description: manifest.description || null,
      status: 'installed',
    });
    const version = await this.versionRepository.save({
      manifestJson: manifest,
      packageHash: body.packageHash || 'local-dev-package',
      pluginId: plugin.id,
      version: manifest.version,
    });

    await this.persistManifestCapabilities(plugin.id, manifest);

    return this.installationRepository.save({
      installedPath: body.packagePath || '',
      pluginId: plugin.id,
      runtimeStatus: 'stopped',
      status: 'installed',
      versionId: version.id,
    });
  }

  async setInstallationStatus(
    body: InstallationActionBody,
    status: QqbotPluginInstallStatus,
  ) {
    if (!body.id) throwVbenError('请选择插件安装记录');

    await this.installationRepository.update({ id: body.id }, { status });
    return {
      id: body.id,
      status,
    };
  }

  async updateConfig(body: UpdateConfigBody) {
    if (!body.pluginId || !body.configKey) {
      throwVbenError('请选择插件和配置项');
    }

    return this.configRepository.save({
      configKey: body.configKey,
      configValue: body.value === undefined ? null : { value: body.value },
      pluginId: body.pluginId,
    });
  }

  async listRuntimeEvents(pluginId?: string) {
    return this.runtimeEventRepository.find({
      where: pluginId ? { pluginId } : undefined,
    });
  }

  async listAccountBindings(pluginId?: string) {
    return this.accountBindingRepository.find({
      where: pluginId ? { pluginId } : undefined,
    });
  }

  private async persistManifestCapabilities(
    pluginId: string,
    manifest: QqbotPluginManifest,
  ) {
    await Promise.all([
      ...manifest.operations.map((operation) =>
        this.operationRepository.save({
          enabled: true,
          handlerName: operation.handlerName,
          operationKey: operation.key,
          operationName: operation.name,
          pluginId,
        }),
      ),
      ...manifest.events.map((event) =>
        this.eventHandlerRepository.save({
          enabled: true,
          eventKey: event.key,
          handlerName: event.handlerName,
          pluginId,
        }),
      ),
      ...manifest.assets.map((asset) =>
        this.assetRepository.save({
          assetKey: asset.key,
          assetPath: asset.path,
          contentHash: asset.contentHash || '',
          pluginId,
        }),
      ),
    ]);
  }
}
