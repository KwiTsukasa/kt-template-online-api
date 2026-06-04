import request = require('supertest');

export type ControllerRoute = {
  controllerName: string;
  handlerName: string;
  method: string;
  path: string;
};

export type HttpServer = Parameters<typeof request>[0];

export type RouteTestCase = (server: HttpServer) => Promise<void>;
