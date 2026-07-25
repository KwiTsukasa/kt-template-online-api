import { ConfigService } from '@nestjs/config';
import { buildTypeOrmOptions } from '../../src/app.module';

function createConfig(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('AppModule TypeORM options', () => {
  it('uses +08:00 as the default MySQL session timezone to keep persisted timestamps in China time', () => {
    const options = buildTypeOrmOptions(
      createConfig({
        DB_HOST: 'mysql',
        DB_PORT: 3306,
        DB_USERNAME: 'kt',
        DB_PASSWORD: 'password',
        DB_DATABASE: 'kt',
      }),
    );

    expect(options).toMatchObject({
      timezone: '+08:00',
      type: 'mysql',
    });
  });

  it('allows DB_TIMEZONE to override the default when a deployment needs a different MySQL session timezone', () => {
    const options = buildTypeOrmOptions(
      createConfig({
        DB_TIMEZONE: 'Z',
      }),
    );

    expect(options.timezone).toBe('Z');
  });
});
