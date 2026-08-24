/**
 * HTTP API 客户端
 * - fetch 封装，自动拼 baseURL / 超时 / JSON 解析
 * - 不引入 axios，保持依赖最小
 */
import { config } from '../config';

export interface ApiError extends Error {
  status: number;
  code?: string;
  payload?: unknown;
}

const DEFAULT_TIMEOUT_MS = 15_000;

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const url = `${config.apiBaseUrl}${path}`;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    // 204 No Content
    if (res.status === 204) {
      return undefined as T;
    }

    const contentType = res.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const payload: unknown = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      const err = new Error(
        `HTTP ${res.status} ${res.statusText} on ${method} ${path}`,
      ) as ApiError;
      err.status = res.status;
      err.payload = payload;
      // 业务约定的 { code, message } 格式
      if (isJson && payload && typeof payload === 'object') {
        const obj = payload as Record<string, unknown>;
        if (typeof obj.code === 'string') err.code = obj.code;
        if (typeof obj.message === 'string') err.message = obj.message;
      }
      throw err;
    }

    return payload as T;
  } catch (e) {
    if ((e as ApiError).status) throw e;
    // 网络/超时错误统一包装
    const err = new Error(
      (e as Error).name === 'AbortError'
        ? `请求超时（${timeoutMs}ms）：${method} ${path}`
        : `网络错误：${(e as Error).message}`,
    ) as ApiError;
    err.status = 0;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: <T>(path: string, options?: { timeoutMs?: number }) =>
    request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: { timeoutMs?: number }) =>
    request<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
