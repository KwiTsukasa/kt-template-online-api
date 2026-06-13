import type { OpenAPIObject } from '@nestjs/swagger';
import { applySwaggerResponseExamples } from '../../src/common/swagger/swagger-response';

describe('applySwaggerResponseExamples', () => {
  it('keeps runtime health swagger response as plain JSON instead of Vben success wrapper', () => {
    const document = {
      openapi: '3.0.0',
      info: {
        title: 'KT API',
        version: 'test',
      },
      paths: {
        '/health/runtime': {
          get: {
            summary: 'Get machine-readable API runtime health',
            responses: {},
          },
        },
      },
    } as unknown as OpenAPIObject;

    applySwaggerResponseExamples(document);

    const operation = (document.paths['/health/runtime'] as any).get;
    const jsonContent = operation.responses['200'].content['application/json'];

    expect(jsonContent.example).toEqual(
      expect.objectContaining({
        service: 'kt-template-online-api',
        status: 'degraded',
        checks: expect.any(Array),
      }),
    );
    expect(jsonContent.example).not.toHaveProperty('code');
    expect(jsonContent.example).not.toHaveProperty('msg');
    expect(jsonContent.example).not.toHaveProperty('data');
    expect(jsonContent.example).not.toHaveProperty('config');
    expect(jsonContent.schema).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          service: expect.any(Object),
          checks: expect.any(Object),
        }),
      }),
    );
  });
});
