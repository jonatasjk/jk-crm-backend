/**
 * Global test setup: inject required env vars before any module is imported
 * so that src/config/env.ts passes validation.
 */
process.env['NODE_ENV'] = 'test';
process.env['MONGODB_URI'] = 'mongodb://localhost:27017/test'; // overridden by MongoMemoryServer
process.env['JWT_SECRET'] = 'super-secret-key-for-testing-only-32chars!!';
process.env['JWT_EXPIRES_IN'] = '1h';
process.env['RESEND_API_KEY'] = 're_test_key';
process.env['RESEND_WEBHOOK_SECRET'] = 'whsec_dGVzdHNlY3JldA==';
process.env['FROM_EMAIL'] = 'test@example.com';
process.env['FROM_NAME'] = 'Test CRM';
process.env['FRONTEND_URL'] = 'http://localhost:5173';
process.env['UPLOADS_DIR'] = 'uploads-test';
process.env['PORT'] = '3099';
