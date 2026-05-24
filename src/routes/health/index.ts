import type { Context } from 'hono';

export async function handleHealth(c: Context) {
  return c.text('custom-expo-updates-server is running.');
}
