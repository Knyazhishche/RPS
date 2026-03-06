import amqp, { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { AppError } from '../modules/shared/errors';

export type EventHandler = (routingKey: string, payload: unknown) => Promise<void>;

export class EventBus {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  constructor(
    private readonly amqpUrl: string,
    private readonly exchange: string
  ) {}

  async connect(): Promise<void> {
    if (this.connection && this.channel) {
      return;
    }

    this.connection = await amqp.connect(this.amqpUrl);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange(this.exchange, 'topic', { durable: true });
  }

  async publish(routingKey: string, payload: unknown): Promise<void> {
    const channel = this.getChannel();
    channel.publish(this.exchange, routingKey, Buffer.from(JSON.stringify(payload)), {
      contentType: 'application/json',
      persistent: true,
      timestamp: Date.now()
    });
  }

  async subscribe(queueName: string, bindings: string[], handler: EventHandler): Promise<void> {
    const channel = this.getChannel();
    await channel.assertQueue(queueName, { durable: true });

    for (const binding of bindings) {
      await channel.bindQueue(queueName, this.exchange, binding);
    }

    await channel.consume(queueName, async (message) => {
      if (!message) {
        return;
      }

      await this.handleMessage(channel, message, handler);
    });
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
    this.channel = null;
    this.connection = null;
  }

  private getChannel(): Channel {
    if (!this.channel) {
      throw new AppError('Event bus is not connected', 500, 'EVENT_BUS_NOT_CONNECTED');
    }

    return this.channel;
  }

  private async handleMessage(channel: Channel, message: ConsumeMessage, handler: EventHandler): Promise<void> {
    try {
      const content = message.content.toString('utf-8');
      const parsed = JSON.parse(content) as unknown;
      await handler(message.fields.routingKey, parsed);
      channel.ack(message);
    } catch (error) {
      channel.nack(message, false, false);
    }
  }
}
