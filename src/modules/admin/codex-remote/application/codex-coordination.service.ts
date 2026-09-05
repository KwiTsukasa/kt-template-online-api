import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { once } from 'node:events';
import type { Response as ExpressResponse } from 'express';
import type { AdminUser } from '@/modules/admin/identity/user/admin-user.entity';
import { CodexRemoteService } from './codex-remote.service';

@Injectable()
export class CodexCoordinationService {
  constructor(private readonly remote: CodexRemoteService) {}

  /**
   * 为当前管理员读取 Windows KT 项目的协调快照，沿用 Remote 短期凭据。
   * @param user - 当前通过超级管理员校验的用户。
   * @returns 项目内任务、资源占用和协调事件的有界快照。
   * @throws PC 不可达或快照格式不符合合同时返回服务不可用异常。
   */
  async snapshot(user: AdminUser) {
    try {
      const session = this.remote.createSession('pc', 'kt', user);
      const upstream = await fetch(
        'http://10.66.66.4:48094/workflow-coordination',
        {
          headers: { Authorization: `Bearer ${session.token}` },
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!upstream.ok) throw new Error('upstream unavailable');
      const text = await upstream.text();
      if (Buffer.byteLength(text) > 2 * 1024 * 1024)
        throw new Error('snapshot too large');
      const snapshot = JSON.parse(text) as Record<string, unknown>;
      if (
        snapshot.schemaVersion !== 1 ||
        !Array.isArray(snapshot.tasks) ||
        !Array.isArray(snapshot.claims) ||
        !Array.isArray(snapshot.events) ||
        typeof snapshot.snapshotId !== 'string'
      )
        throw new Error('snapshot invalid');
      return snapshot;
    } catch {
      throw new ServiceUnavailableException('PC 协调中心暂不可用');
    }
  }

  /**
   * 转发 Windows 状态变化事件，背压时等待排空，断开或到期时取消上游读取。
   * @param user - 当前通过超级管理员校验的用户。
   * @param response - 接收实时快照的管理端响应。
   * @throws 上游建立失败且尚未发送响应头时返回服务不可用异常。
   */
  async stream(user: AdminUser, response: ExpressResponse): Promise<void> {
    const controller = new AbortController();
    const close = () => controller.abort();
    response.once('close', close);
    const headerTimeout = setTimeout(close, 8000);
    const expiry = setTimeout(close, 115000);
    try {
      const session = this.remote.createSession('pc', 'kt', user);
      const upstream = await fetch(
        'http://10.66.66.4:48094/workflow-coordination/events',
        {
          headers: {
            Authorization: `Bearer ${session.token}`,
            Accept: 'text/event-stream',
          },
          redirect: 'error',
          signal: controller.signal,
        },
      );
      clearTimeout(headerTimeout);
      if (
        !upstream.ok ||
        !upstream.body ||
        !upstream.headers.get('content-type')?.startsWith('text/event-stream')
      )
        throw new Error('stream unavailable');
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();
      const reader = upstream.body.getReader();
      try {
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (!response.write(chunk.value)) {
            await once(response, 'drain', { signal: controller.signal });
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } catch {
      if (!response.headersSent && !response.destroyed)
        throw new ServiceUnavailableException('PC 协调中心暂不可用');
      if (!response.destroyed)
        response.write('event: coordination-unavailable\ndata: {}\n\n');
    } finally {
      clearTimeout(headerTimeout);
      clearTimeout(expiry);
      controller.abort();
      response.off('close', close);
      if (response.headersSent && !response.writableEnded) response.end();
    }
  }
}
