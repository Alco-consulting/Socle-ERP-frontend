import { environment as production } from './environment.production';
import { environment as development } from './environment.development';
import { environment as testing } from './environment.testing';

const ALL = { production, development, testing };

describe('Environments', () => {
  it('production talks to the deployed API', () => {
    expect(production.apiBaseUrl).toBe('https://api.alcoconsulting.tech/api/v1');
  });

  it('development goes through the dev proxy (relative URL, same origin)', () => {
    expect(development.apiBaseUrl).toBe('/api/v1');
  });

  it('tests never target the real API', () => {
    expect(testing.apiBaseUrl.startsWith('http')).toBe(false);
  });

  it('holds no secret: everything here is public in the browser', () => {
    for (const [name, env] of Object.entries(ALL)) {
      expect(Object.keys(env).sort(), name).toEqual([
        'apiBaseUrl',
        'name',
        'requestTimeoutMs',
        'uploadTimeoutMs',
      ]);
      expect(JSON.stringify(env), name).not.toMatch(/secret|password|token|apikey|api_key/i);
    }
  });
});
