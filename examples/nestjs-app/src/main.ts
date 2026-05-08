import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.warn(`nest-warden example listening on http://localhost:${port}`);
}

bootstrap().catch((err: unknown) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
