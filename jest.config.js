module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  verbose: true,
  testTimeout: 30000,
  maxWorkers: 1,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
