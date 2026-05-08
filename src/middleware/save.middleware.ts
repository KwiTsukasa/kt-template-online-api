import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response } from 'express';

@Injectable()
export class SaveMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: VoidFunction) {
    Reflect.deleteProperty(req.body, 'id');
    next();
  }
}
