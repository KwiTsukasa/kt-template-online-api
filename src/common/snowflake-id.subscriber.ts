import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
} from 'typeorm';
import { ensureSnowflakeId } from './snowflake-id';

@EventSubscriber()
export class SnowflakeIdSubscriber implements EntitySubscriberInterface {
  beforeInsert(event: InsertEvent<any>) {
    if (!event.entity) return;

    const idColumn = event.metadata.primaryColumns.find(
      (column) => column.propertyName === 'id',
    );
    if (idColumn?.type !== 'bigint') return;

    ensureSnowflakeId(event.entity);
  }
}
