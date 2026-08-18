import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('message_subscription_template')
@Index(
  'uk_message_subscription_template_order',
  ['subscriptionId', 'sortOrder'],
  { unique: true },
)
export class MessageSubscriptionTemplate {
  @PrimaryColumn({ name: 'subscription_id', type: 'bigint' })
  subscriptionId: string;

  @PrimaryColumn({ name: 'template_id', type: 'bigint' })
  templateId: string;

  @Column({ name: 'sort_order', type: 'int', unsigned: true })
  sortOrder: number;
}
