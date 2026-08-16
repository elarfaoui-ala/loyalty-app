import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

const REQUIRED_SECRETS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'CUSTOMER_TOKEN_SECRET',
] as const;

const logger = new Logger('Bootstrap');

/**
 * Fails fast (production) or warns loudly (development) when the deployment
 * is running on placeholder secrets — shipping `change-me-*` values would
 * let anyone forge access, refresh, customer and check-in tokens.
 */
function validateEnv(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const allowInsecure = process.env.ALLOW_INSECURE_DEV === '2';

  for (const key of REQUIRED_SECRETS) {
    const value = process.env[key] ?? '';
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    const insecure = value.startsWith('change-me') || value.length < 24;
    if (insecure && (isProd || !allowInsecure)) {
      throw new Error(
        `${key} must be a unique, random secret of at least 24 characters ` +
          `(got "${value}"). Generate one with: openssl rand -hex 32` +
          (allowInsecure
            ? ''
            : ' Or, for local development only, set ALLOW_INSECURE_DEV=1 to skip this check.'),
      );
    }
  }

  const cors = process.env.CORS_ORIGIN;
  if (isProd && (!cors || cors === '*')) {
    throw new Error(
      'CORS_ORIGIN must list explicit allowed origins in production ' +
        '(comma-separated). A wildcard origin is not permitted.',
    );
  }
}

async function bootstrap() {
  validateEnv();

  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  const corsOrigins = (process.env.CORS_ORIGIN ?? '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    // An array element of '*' is treated by the `cors` package as a literal
    // host to match, which would disable CORS entirely. Pass the bare '*'
    // string so the wildcard actually works.
    origin: corsOrigins.includes('*') ? '*' : corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api/v1');

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Loyalty API')
    .setDescription(
      'Multi-tenant loyalty / punch-card API. Public endpoints power the ' +
        'embeddable widget; business endpoints power the dashboard; the API ' +
        'key endpoints are for server-to-server stamps from a POS/checkout.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Business or customer JWT' },
      'bearer',
    )
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument, {
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha', operationsSorter: 'alpha' },
  });

  app.enableShutdownHooks();

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  logger.log(`Loyalty API listening on :${port}`);
}
bootstrap();
