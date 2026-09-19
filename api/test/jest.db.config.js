/** @type {import('jest').Config} */
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testMatch: ['<rootDir>/test/db/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
