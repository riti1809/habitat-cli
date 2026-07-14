type RegistrationLike = {
  registeredAt?: string;
};

export function resolveRegisteredAt(
  primary: RegistrationLike,
  fallback?: RegistrationLike,
) {
  return primary.registeredAt ?? fallback?.registeredAt ?? "unknown";
}
