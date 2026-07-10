export class ApiClientError extends Error {
  status: number;
  statusText: string;

  constructor(message: string, status: number, statusText: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.statusText = statusText;
  }
}

export type JsonRequestOptions = Omit<RequestInit, "body"> & {
  baseUrl?: string;
  apiToken?: string;
  body?: unknown;
};

export type JsonResponse<TResponse> = {
  status: number;
  data: TResponse;
};

const defaultBaseUrl = "http://localhost:8787";

export function getApiBaseUrl(baseUrl = process.env.HABITAT_API_BASE_URL) {
  return (baseUrl ?? defaultBaseUrl).replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(parsed: unknown, fallback: string) {
  if (!isRecord(parsed)) {
    return fallback;
  }

  const envelope = parsed.error;

  if (isRecord(envelope)) {
    const message = envelope.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }

    const code = envelope.code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }

  if (typeof parsed.message === "string" && parsed.message.length > 0) {
    return parsed.message;
  }

  if (typeof parsed.code === "string" && parsed.code.length > 0) {
    return parsed.code;
  }

  return fallback;
}

async function parseFriendlyError(response: Response) {
  const fallback = `${response.status} ${response.statusText}`.trim();

  try {
    const text = await response.text();

    if (!text.trim()) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      return getErrorMessage(parsed, fallback);
    } catch {
      return text.trim();
    }
  } catch {
    return fallback;
  }
}

export async function requestJson<TResponse>(
  path: string,
  options: JsonRequestOptions = {},
) {
  const response = await requestJsonWithStatus<TResponse>(path, options);
  return response.data;
}

export async function requestJsonWithStatus<TResponse>(
  path: string,
  options: JsonRequestOptions = {},
) {
  const baseUrl = getApiBaseUrl(options.baseUrl);
  const headers = new Headers(options.headers);

  headers.set("Accept", "application/json");

  if (options.apiToken) {
    headers.set("Authorization", `Bearer ${options.apiToken}`);
  }

  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    body,
  });

  if (!response.ok) {
    throw new ApiClientError(
      await parseFriendlyError(response),
      response.status,
      response.statusText,
    );
  }

  if (response.status === 204) {
    return {
      status: response.status,
      data: undefined as TResponse,
    };
  }

  return {
    status: response.status,
    data: (await response.json()) as TResponse,
  };
}
