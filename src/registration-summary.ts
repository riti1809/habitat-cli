import type { StoredRegistration } from "./habitat-store.ts";

type RegistrationLike = {
  registeredAt?: string;
};

export function resolveRegisteredAt(
  primary: RegistrationLike,
  fallback?: RegistrationLike,
) {
  return primary.registeredAt ?? fallback?.registeredAt ?? "unknown";
}

export function formatStreamRegistrationStatus(registration: StoredRegistration) {
  return [
    `Stream URL: ${registration.streamUrl ?? "unknown"}`,
    `Stream API token: ${registration.apiToken ?? "not available"}`,
    `Subscriptions: ${registration.stream?.subscriptions.join(", ") ?? "none"}`,
    `Registration clock tick: ${registration.stream?.currentTick ?? "unknown"}`,
    `Registration stream status: ${registration.stream?.status ?? "unknown"}`,
    `Ticks per pulse: ${registration.stream?.ticksPerPulse ?? "unknown"}`,
  ];
}
