import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
} from 'typeorm';
import { ensureSnowflakeId } from './snowflake-id';

@EventSubscriber()
export class SnowflakeIdSubscriber implements EntitySubscriberInterface {
  /**
   * 执行 当前模块流程。
   * @param event - event 输入；使用 `entity`、`metadata` 字段生成结果。
   */
  beforeInsert(event: InsertEvent<any>) {
    if (!event.entity) return;

    const idColumn = event.metadata.primaryColumns.find(
      (column) => column.propertyName === 'id',
    );
    if (idColumn?.type !== 'bigint') return;

    ensureSnowflakeId(event.entity);
  }
}
