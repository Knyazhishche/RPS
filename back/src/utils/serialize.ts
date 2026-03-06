export function serializeBigInt<T>(payload: T): T {
  if (payload === null || payload === undefined) {
    return payload;
  }

  return JSON.parse(
    JSON.stringify(payload, (_, value: unknown) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }

      return value;
    })
  ) as T;
}
