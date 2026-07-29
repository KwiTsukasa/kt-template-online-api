import { ConfigService } from '@nestjs/config';
import pino from 'pino';
import { createPinoLoggerParams } from '../../../src/common/logger/pino-logger.config';

const PASSWORD_FIELDS = [
  'password',
  'loginPassword',
  'encryptedPassword',
  'encryptedLoginPassword',
] as const;

describe('Pino password redaction', () => {
  it('recursively redacts password fields in arrays, requests, errors, and structured objects without mutating inputs', () => {
    const params = createPinoLoggerParams(
      new ConfigService({
        LOG_PRETTY: 'false',
        NODE_ENV: 'test',
      }),
    );
    const { hooks, redact } = params.pinoHttp as any;
    const values = Object.fromEntries(
      PASSWORD_FIELDS.map((field) => [field, `sensitive-${field}`]),
    );
    const error = Object.assign(new Error('request failed'), {
      details: {
        nested: {
          deeper: { ...values },
        },
      },
    });
    const input = {
      ...values,
      body: {
        nested: {
          deeper: { ...values },
        },
        rows: [{ ...values }, { child: { ...values } }],
        token: 'sensitive-body-token',
      },
      envelope: {
        nested: {
          deeper: { ...values },
        },
      },
      err: error,
      req: {
        body: {
          nested: {
            deeper: { ...values },
          },
          rows: [{ ...values }],
        },
        headers: {
          authorization: 'Bearer sensitive-authorization',
        },
      },
    };
    const originalErrorStack = error.stack;
    const output: string[] = [];
    const logger = pino({ hooks: hooks || {}, redact }, {
      write: (chunk: string) => output.push(chunk),
    } as any);

    logger.error(input, 'request failed');

    const record = JSON.parse(output.join(''));
    PASSWORD_FIELDS.forEach((field) => {
      expect(record[field]).toBe('[Redacted]');
      expect(record.body.nested.deeper[field]).toBe('[Redacted]');
      expect(record.body.rows[0][field]).toBe('[Redacted]');
      expect(record.body.rows[1].child[field]).toBe('[Redacted]');
      expect(record.envelope.nested.deeper[field]).toBe('[Redacted]');
      expect(record.err.details.nested.deeper[field]).toBe('[Redacted]');
      expect(record.req.body.nested.deeper[field]).toBe('[Redacted]');
      expect(record.req.body.rows[0][field]).toBe('[Redacted]');
      expect(JSON.stringify(record)).not.toContain(`sensitive-${field}`);
      expect(input[field]).toBe(`sensitive-${field}`);
      expect(input.body.nested.deeper[field]).toBe(`sensitive-${field}`);
      expect(input.body.rows[0][field]).toBe(`sensitive-${field}`);
      expect(input.err.details.nested.deeper[field]).toBe(`sensitive-${field}`);
      expect(input.req.body.nested.deeper[field]).toBe(`sensitive-${field}`);
    });
    expect(record.err.message).toBe('request failed');
    expect(record.err.stack).toBe(originalErrorStack);
    expect(record.body.token).toBe('[Redacted]');
    expect(record.req.headers.authorization).toBe('[Redacted]');
    expect(input.body.token).toBe('sensitive-body-token');
    expect(input.req.headers.authorization).toBe(
      'Bearer sensitive-authorization',
    );
    expect(error.message).toBe('request failed');
    expect(error.stack).toBe(originalErrorStack);
  });

  it.each(['\n', '\r\n'])(
    'fails closed with a fixed JSON record and preserves %j when serialized input is malformed',
    (lineEnding) => {
      const params = createPinoLoggerParams(
        new ConfigService({
          LOG_PRETTY: 'false',
          NODE_ENV: 'test',
        }),
      );
      const streamWrite = (params.pinoHttp as any).hooks.streamWrite;

      const output = streamWrite(`malformed sensitive-password${lineEnding}`);

      expect(output.endsWith(lineEnding)).toBe(true);
      expect(JSON.parse(output)).toEqual({
        level: 50,
        msg: '日志脱敏失败',
        redactionError: true,
      });
      expect(output).not.toContain('sensitive-password');
      expect(output).not.toContain('malformed');
    },
  );

  it('handles deeply nested password fields without recursive traversal', () => {
    const params = createPinoLoggerParams(
      new ConfigService({
        LOG_PRETTY: 'false',
        NODE_ENV: 'test',
      }),
    );
    const streamWrite = (params.pinoHttp as any).hooks.streamWrite;
    const depth = 2000;
    const serialized = `${'{"nested":'.repeat(depth)}{"password":"deep-secret"}${'}'.repeat(depth)}\n`;

    const output = streamWrite(serialized);

    expect(output).not.toContain('deep-secret');
    expect(JSON.parse(output)).toBeDefined();
  });

  it('preserves integers outside the safe range while redacting passwords', () => {
    const params = createPinoLoggerParams(
      new ConfigService({
        LOG_PRETTY: 'false',
        NODE_ENV: 'test',
      }),
    );
    const { hooks, redact } = params.pinoHttp as any;
    const output: string[] = [];
    const logger = pino({ hooks: hooks || {}, redact }, {
      write: (chunk: string) => output.push(chunk),
    } as any);

    logger.info({
      password: 'sensitive-password',
      snowflakeId: 9007199254740993n,
    });

    const serialized = output.join('');
    expect(serialized).toContain('"snowflakeId":9007199254740993');
    expect(serialized).toContain('"password":"[Redacted]"');
    expect(serialized).not.toContain('sensitive-password');
  });
});
